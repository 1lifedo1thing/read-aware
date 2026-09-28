/**
 * Findings and the HTML report for the book corpus probe (`run-corpus-probe.ts`), organized
 * by the four questions the probe answers: TOC extraction, chapter separation, rendering and
 * performance.
 *
 * `classifyBook` turns one book's measurements into findings. Thresholds separate "broken"
 * (error) from "works, degraded" (warning) and "worth knowing" (info); every finding keeps
 * the numbers behind it, and the report shows screenshots and mismatch samples so a person
 * can overrule a heuristic.
 */
import type { ChapterSummary, OpenResult, RenderSample, RenderSetup, TocSummary } from "../tests/corpus/probe-types";

export type ConsoleEntry = { level: "exception" | "error" | "warning"; text: string };

export type CorpusBook = {
  /** First 12 hex digits of the file's SHA-256: stable across runs. */
  id: string;
  path: string;
  relPath: string;
  name: string;
  bytes: number;
  sha256: string;
  /** The extension routes nothing; only a sniffed binary book format is probed. */
  sniffOnly: boolean;
  duplicateOf?: string;
  skipped?: string;
  open?: OpenResult;
  toc?: TocSummary;
  renders: RenderSetup[];
  samples: RenderSample[];
  chapters?: ChapterSummary;
  peakHeapBytes?: number;
  console: ConsoleEntry[];
  stepErrors: { step: string; error: string; timeout: boolean }[];
  crashed?: boolean;
  abandoned?: boolean;
  totalMs?: number;
};

export type Dimension = "open" | "toc" | "chapters" | "render" | "perf";
export type Severity = "error" | "warning" | "info";
export type Finding = { dimension: Dimension; severity: Severity; code: string; message: string };

export const DIMENSIONS: { key: Dimension; title: string; question: string }[] = [
  { key: "open", title: "打开", question: "文件能否被识别和解析（其余四项的前提）" },
  { key: "toc", title: "目录获取", question: "书自带的目录能否取到、每一项能否跳转" },
  { key: "chapters", title: "章节区分", question: "目录能否把书正确切成章节：顺序、边界、标题与正文是否对得上" },
  { key: "render", title: "渲染布局", question: "抽样章节在默认分页和连续滚动下能否正确显示" },
  { key: "perf", title: "大文件性能", question: "解析、首屏、跳转、全书章节抽取的耗时与内存" },
];

export const FINDING_LABELS: Record<string, string> = {
  "open/encrypted": "DRM 加密，无法打开",
  "open/unsupported": "格式不受支持",
  "open/failed": "解析失败，无法打开",
  "open/probe-timeout": "处理超时",
  "open/probe-crashed": "页面崩溃",
  "open/probe-failed": "探针步骤出错",
  "toc/none": "没有目录",
  "toc/unresolved": "目录项无法跳转",
  "toc/repaired": "目录经 app 修复/合成",
  "toc/empty-labels": "目录项没有标题",
  "chapters/single-root": "目录只有一个顶层节点，整本书成了一章",
  "chapters/out-of-order": "章节入口顺序颠倒",
  "chapters/spilled": "子目录落在别的章节里，章节边界错位",
  "chapters/collapsed": "多个章节指向同一位置",
  "chapters/collapsed-front": "前后相邻的目录项指向同一处",
  "chapters/label-mismatch": "跳转后看到的不是该章标题",
  "chapters/top-level-only": "只按顶层目录分章，子目录被忽略",
  "chapters/oversized": "目录本身只到卷/册一级",
  "chapters/extraction-failed": "章节文本抽取失败",
  "chapters/extraction-timeout": "章节抽取未在预算内完成",
  "chapters/textless": "没有文字层，无法按文本分章",
  "render/setup-failed": "阅读视图初始化失败",
  "render/failed": "章节渲染失败",
  "render/blank": "渲染出空白页",
  "render/broken-images": "图片加载失败",
  "render/overflow": "内容超出版心",
  "render/tiny-text": "大量文字字号过小",
  "render/exceptions": "渲染时出现未捕获异常",
  "perf/slow-parse": "解析慢",
  "perf/slow-toc": "目录修复慢（在打开路径上）",
  "perf/slow-first-page": "首屏慢",
  "perf/slow-jump": "章节跳转慢",
  "perf/slow-chapters": "全书章节抽取慢",
  "perf/heap": "内存占用高",
};

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
/** `read_chapter` windows a chapter into parts of this many characters (packages/agent book-text-tools). */
const CHAPTER_PART_CHARS = 12_000;
const NUMBERED_CHAPTER = /第\s*[0-9一二三四五六七八九十百零〇两]+\s*[章回节]|^chapter\s+\S+|^\d+$/iu;

const percent = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
export const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const megabytes = (bytes: number) => `${Math.round(bytes / (1 << 20))} MB`;
const list = (items: string[], limit = 4) =>
  items
    .slice(0, limit)
    .map((item) => `「${item}」`)
    .join("") + (items.length > limit ? ` 等 ${items.length} 项` : "");

/** Time from opening the view to the first chapter on screen, in the reader's default mode. */
export function firstPageMs(book: CorpusBook): number | null {
  const setup = book.renders[0];
  const first = book.samples.find((sample) => setup && sample.mode === setup.mode);
  return setup?.ok && first?.ok ? setup.ms + first.ms : null;
}

export function classifyBook(book: CorpusBook): Finding[] {
  const findings: Finding[] = [];
  const add = (dimension: Dimension, severity: Severity, code: string, message: string) =>
    findings.push({ dimension, severity, code, message });
  if (book.duplicateOf || book.skipped) return findings;

  for (const { step, error, timeout } of book.stepErrors) {
    if (timeout) add("open", "error", "open/probe-timeout", `${step}: ${error}`);
    else if (!book.crashed) add("open", "error", "open/probe-failed", `${step}: ${error}`);
  }
  if (book.crashed) add("open", "error", "open/probe-crashed", "渲染进程崩溃（通常是内存耗尽）");

  const open = book.open;
  if (open && !open.ok) {
    const { status, errorCode, message } = open.failure;
    add("open", "error", `open/${status}`, `${errorCode} · ${message}`);
  }
  if (!open?.ok) return findings;
  const summary = open.summary;
  const pdf = summary.formatHint === "pdf";

  // 1. TOC extraction
  const toc = book.toc;
  if (toc) {
    if (toc.entries === 0 && summary.linearSections > 1)
      add(
        "toc",
        "warning",
        "toc/none",
        pdf
          ? "PDF 没有书签（outline），app 不会为 PDF 合成目录"
          : summary.linearSections > 60
            ? `书里没有目录；${summary.linearSections} 个章节文件超过 app 合成目录的上限（60）`
            : "书里没有目录，app 也没能按标题合成",
      );
    if (toc.unresolved > 0) {
      const total = toc.entries || toc.unresolved;
      add(
        "toc",
        toc.unresolved / total >= 0.2 ? "error" : "warning",
        "toc/unresolved",
        `${toc.unresolved}/${total} 项无法解析：${toc.unresolvedSamples.join("；")}`,
      );
    }
    if (toc.repair !== "none")
      add(
        "toc",
        "info",
        "toc/repaired",
        toc.repair === "synthesized"
          ? `原目录 ${toc.sourceEntries} 项覆盖不足，按章节标题合成到 ${toc.entries} 项`
          : "原目录的跳转目标塌缩在一处，已按章节标题重新定位",
      );
    if (toc.emptyLabels > 0) add("toc", "info", "toc/empty-labels", `${toc.emptyLabels} 项没有标题`);
  }

  // 2. Chapter separation
  const chapters = book.chapters;
  const structural = new Set<string>();
  if (toc) {
    if (toc.chapterEntries === 1 && toc.entries >= 4) {
      structural.add("single-root");
      add(
        "chapters",
        "warning",
        "chapters/single-root",
        `顶层只有「${book.chapters?.chapters[0]?.title ?? "1 项"}」，其下 ${toc.entries - 1} 项子目录都不参与分章`,
      );
    }
    if (toc.outOfOrder.length) {
      structural.add("order");
      add(
        "chapters",
        "error",
        "chapters/out-of-order",
        `${toc.outOfOrder.length} 个章节入口早于前一章：${list(toc.outOfOrder)}`,
      );
    }
    if (toc.spilled.length) {
      structural.add("spill");
      const outside = toc.spilled.reduce((total, entry) => total + entry.outside, 0);
      add(
        "chapters",
        "error",
        "chapters/spilled",
        `${toc.spilled.length} 章共 ${outside} 个子目录项不在本章范围内，正文会被算进别的章：${list(
          toc.spilled.map((entry) => entry.label),
        )}。例如「${toc.spilled[0]!.label}」下的 ${toc.spilled[0]!.examples.join("、")}`,
      );
    }
    // Numbered chapters sharing one spot mean navigation lands on the wrong chapter. Other
    // shared spots are usually a number/title pair or front matter in one file.
    const numbered = toc.collapsed.filter((group) => group.filter((label) => NUMBERED_CHAPTER.test(label)).length >= 2);
    if (numbered.length)
      add(
        "chapters",
        "warning",
        "chapters/collapsed",
        `${numbered.length} 组编号章节落在同一位置，点后面的章会跳到前面那章：${numbered
          .slice(0, 3)
          .map((group) => group.join(" / "))
          .join("；")}`,
      );
    else if (toc.collapsed.length)
      add(
        "chapters",
        "info",
        "chapters/collapsed-front",
        `${toc.collapsed.length} 组：${toc.collapsed
          .slice(0, 2)
          .map((group) => group.join(" / "))
          .join("；")}`,
      );
    if (toc.labelChecked >= 5) {
      const rate = toc.labelMatched / toc.labelChecked;
      if (rate < 0.7)
        add(
          "chapters",
          rate < 0.4 ? "error" : "warning",
          "chapters/label-mismatch",
          `抽查 ${toc.labelChecked} 项只有 ${percent(rate)} 对得上${
            toc.labelPictured ? `（另有 ${toc.labelPictured} 项落在图片标题/扉页上，未计入）` : ""
          }，例如 ${toc.mismatches
            .slice(0, 3)
            .map((mismatch) => `「${mismatch.label}」→「${mismatch.found || "（空）"}」`)
            .join("；")}`,
        );
    }
  }
  if (chapters) {
    if (chapters.error) add("chapters", "error", "chapters/extraction-failed", chapters.error);
    if (chapters.failed > 0)
      add(
        "chapters",
        "error",
        "chapters/extraction-failed",
        `${chapters.failed}/${chapters.required} 个文件读取失败：${chapters.failureCodes.join("、")}`,
      );
    if (chapters.timedOut)
      add("chapters", "warning", "chapters/extraction-timeout", `完成 ${chapters.completed}/${chapters.required}`);
    if (chapters.text === "textless")
      add("chapters", "info", "chapters/textless", "扫描版或纯图，章节只能靠页码/书签区分");
    const sizes = chapters.chapters.map((chapter) => chapter.chars);
    const largest = Math.max(0, ...sizes);
    const biggest = chapters.chapters[sizes.indexOf(largest)];
    const parts = Math.ceil(largest / CHAPTER_PART_CHARS);
    if (parts >= 10 && !structural.size && biggest) {
      const nested = toc?.chapterNested.find((entry) => entry.title === biggest.title)?.nested ?? 0;
      if (nested > 0)
        add(
          "chapters",
          "warning",
          "chapters/top-level-only",
          `「${biggest.title}」被当成一章：${largest.toLocaleString()} 字（Agent 要翻 ${parts} 段），其下 ${nested} 项子目录没有参与分章`,
        );
      else
        add(
          "chapters",
          "info",
          "chapters/oversized",
          `最长「${biggest.title}」${largest.toLocaleString()} 字，Agent 读一章要翻 ${parts} 段`,
        );
    }
  }

  // 3. Rendering and layout
  for (const setup of book.renders)
    if (!setup.ok) add("render", "error", "render/setup-failed", `${setup.mode}：${setup.error}`);
  for (const sample of book.samples) {
    const where = `${sample.mode} · ${sample.label}（第 ${sample.index} 节）`;
    if (!sample.ok) {
      add("render", "error", "render/failed", `${where}：${sample.error}`);
      continue;
    }
    // Only pages with real content are judged: a part-title page ("第一部") is legitimately
    // almost empty, and fixed-layout pages without a text layer may be scans or blank sheets.
    const expectsInk = (sample.textChars ?? 0) >= (summary.fixedLayout ? 50 : 20) || sample.images > 0;
    if (sample.ink !== undefined && sample.ink < 0.002 && expectsInk)
      add(
        "render",
        "error",
        "render/blank",
        `${where}：内容有 ${sample.textChars ?? "?"} 字 / ${sample.images} 图，画面却几乎全空`,
      );
    if (sample.brokenImages > 0)
      add(
        "render",
        "warning",
        "render/broken-images",
        `${where}：${sample.brokenImages}/${sample.images} 张 ${sample.brokenImageSamples.join(" ")}`,
      );
    if (sample.overflows.length)
      add(
        "render",
        "warning",
        "render/overflow",
        `${where}：${sample.overflows
          .map((overflow) => `<${overflow.tag}> 宽 ${overflow.width}px（版心 ${overflow.limit}px）`)
          .join("，")}`,
      );
    if (sample.tinyTextShare > 0.2)
      add("render", "warning", "render/tiny-text", `${where}：${percent(sample.tinyTextShare)} 的文字小于 10.5px`);
  }
  const exceptions = book.console.filter((entry) => entry.level === "exception");
  if (exceptions.length)
    add("render", "warning", "render/exceptions", `${exceptions.length} 个：${exceptions[0]!.text.split("\n")[0]}`);

  // 4. Performance
  if (summary.parseMs > 3000)
    add("perf", summary.parseMs > 10_000 ? "error" : "warning", "perf/slow-parse", seconds(summary.parseMs));
  if (toc && toc.repairMs > 2000) add("perf", "warning", "perf/slow-toc", seconds(toc.repairMs));
  const first = firstPageMs(book);
  if (first !== null && first > 3000) add("perf", "warning", "perf/slow-first-page", seconds(first));
  const jumps = book.samples.filter((sample) => sample.ok).slice(1);
  const slowest = jumps.reduce<RenderSample | null>((max, sample) => (!max || sample.ms > max.ms ? sample : max), null);
  if (slowest && slowest.ms > 2000)
    add("perf", "warning", "perf/slow-jump", `${slowest.mode} · ${slowest.label}：${seconds(slowest.ms)}`);
  if (chapters && !chapters.timedOut && chapters.ms > 60_000)
    add("perf", "warning", "perf/slow-chapters", `${seconds(chapters.ms)}（后台任务，期间 AI/搜索只能拿到部分文本）`);
  if ((book.peakHeapBytes ?? 0) > 1.5 * (1 << 30))
    add("perf", "warning", "perf/heap", `JS 堆峰值 ${megabytes(book.peakHeapBytes!)}`);

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---- HTML ------------------------------------------------------------------

const escape = (value: string | number | null | undefined) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const size = (bytes: number) =>
  bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function formatOf(book: CorpusBook): string {
  const open = book.open;
  const format = open ? (open.ok ? open.summary.formatHint : open.failure.formatHint) : null;
  return format ?? (book.name.split(".").at(-1) ?? "?").toLowerCase();
}

/** Strip the download-site suffix the corpus file names carry, for a readable heading. */
function displayName(book: CorpusBook): string {
  const title = book.open?.ok ? book.open.summary.title : "";
  return title || book.name.replace(/\s*\(z-library[^)]*\)/i, "").replace(/\.[^.]+$/, "");
}

/** Bundle titles carry whole blurbs ("【豆瓣评分9.2！…】"); lists show the name, hover shows all. */
function shortName(book: CorpusBook): string {
  const name = displayName(book)
    .replace(/[【[][^】\]]*[】\]]/gu, "")
    .trim();
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

function bookLink(book: CorpusBook): string {
  return `<a href="#b-${escape(book.id)}" title="${escape(displayName(book))}">${escape(shortName(book))}</a>`;
}

type State = Severity | "ok";
function stateOf(findings: Finding[]): State {
  return findings.find((finding) => finding.severity !== "info")?.severity ?? "ok";
}
const STATE_LABEL: Record<State, string> = { error: "有问题", warning: "有缺陷", info: "正常", ok: "正常" };
const stateRank = (state: State) => (state === "ok" ? 2 : SEVERITY_RANK[state]);

function metric(label: string, value: string) {
  return `<div class="metric"><dt>${escape(label)}</dt><dd>${value}</dd></div>`;
}

function findingList(findings: Finding[]) {
  return findings.length
    ? `<ul class="findings">${findings
        .map(
          (finding) =>
            `<li class="finding ${finding.severity}"><span class="tag">${escape(FINDING_LABELS[finding.code] ?? finding.code)}</span> ${escape(finding.message)}</li>`,
        )
        .join("")}</ul>`
    : `<p class="clean">未发现问题</p>`;
}

function chapterBars(chapters: ChapterSummary): string {
  if (!chapters.chars || chapters.chapters.length < 2) return "";
  const shown = chapters.chapters.slice(0, 400);
  return `<div class="bars" title="每一条是一章，宽度按字数">${shown
    .map(
      (chapter) =>
        `<span style="flex-grow:${chapter.chars}" title="${escape(chapter.title)} · ${chapter.chars.toLocaleString()} 字"></span>`,
    )
    .join("")}</div>`;
}

function bookCard(book: CorpusBook, findings: Finding[]): string {
  const open = book.open?.ok ? book.open.summary : null;
  const toc = book.toc;
  const chapters = book.chapters;
  const state = stateOf(findings);
  const section = (dimension: Dimension, metrics: string, extra = "") => {
    const own = findings.filter((finding) => finding.dimension === dimension);
    const title = DIMENSIONS.find((entry) => entry.key === dimension)!.title;
    return `<section class="dim"><h4>${title}</h4>${findingList(own)}${metrics ? `<dl class="metrics">${metrics}</dl>` : ""}${extra}</section>`;
  };
  const openFindings = findings.filter((finding) => finding.dimension === "open");
  const shots = book.samples
    .filter((sample) => sample.shot)
    .map(
      (sample) =>
        `<figure><img loading="lazy" src="${escape(sample.shot)}" alt=""><figcaption>${escape(sample.mode === "scroll" ? "滚动" : sample.mode === "paginated-double" ? "双页" : sample.mode)} · ${escape(sample.label)} · ${seconds(sample.ms)}</figcaption></figure>`,
    )
    .join("");
  const first = firstPageMs(book);
  const jumps = book.samples.filter((sample) => sample.ok).slice(1);
  const mismatches = toc?.mismatches.length
    ? `<details class="more"><summary>标题不符的抽样</summary><ul class="plain">${toc.mismatches
        .map((mismatch) => `<li>「${escape(mismatch.label)}」→ ${escape(mismatch.found || "（空）")}</li>`)
        .join("")}</ul></details>`
    : "";
  const consoleLines = book.console.length
    ? `<details class="more"><summary>控制台 ${book.console.length} 条</summary><pre>${escape(
        book.console.map((entry) => `[${entry.level}] ${entry.text}`).join("\n"),
      )}</pre></details>`
    : "";
  return `<article class="book ${state}" id="b-${escape(book.id)}" data-state="${state === "info" ? "ok" : state}">
  <header>
    <div>
      <h3>${escape(displayName(book))}</h3>
      <p class="path">${escape(formatOf(book))}${open?.fixedLayout ? " · 固定版式" : ""} · ${size(book.bytes)} · ${escape(book.relPath)}</p>
    </div>
    <span class="verdict ${state}">${STATE_LABEL[state]}</span>
  </header>
  ${openFindings.length ? findingList(openFindings) : ""}
  ${
    open
      ? `<div class="dims">
    ${section(
      "toc",
      toc
        ? [
            metric("原始目录", `${toc.sourceEntries} 项 · ${toc.sourceDepth} 层`),
            metric(
              "修复后",
              `${toc.entries} 项${toc.repair === "none" ? "" : toc.repair === "synthesized" ? "（合成）" : "（重定位）"}`,
            ),
            metric("无法跳转", String(toc.unresolved)),
          ].join("")
        : "",
    )}
    ${section(
      "chapters",
      [
        toc ? metric("章节入口", `${toc.chapterEntries}`) : "",
        toc && toc.labelChecked ? metric("标题抽查", `${toc.labelMatched}/${toc.labelChecked}`) : "",
        toc && toc.labelPictured ? metric("图片标题", String(toc.labelPictured)) : "",
        chapters ? metric("抽出章节", `${chapters.chapters.length} 章 · ${chapters.chars.toLocaleString()} 字`) : "",
      ].join(""),
      (chapters ? chapterBars(chapters) : "") + mismatches,
    )}
    ${section("render", "", shots ? `<div class="shots">${shots}</div>` : "")}
    ${section(
      "perf",
      [
        metric("解析", seconds(open.parseMs)),
        toc ? metric("目录修复", seconds(toc.repairMs)) : "",
        first !== null ? metric("首屏", seconds(first)) : "",
        jumps.length ? metric("最慢跳转", seconds(Math.max(...jumps.map((sample) => sample.ms)))) : "",
        chapters ? metric("章节抽取", seconds(chapters.ms)) : "",
        book.peakHeapBytes ? metric("JS 堆峰值", megabytes(book.peakHeapBytes)) : "",
      ].join(""),
    )}
  </div>`
      : ""
  }
  ${consoleLines}
</article>`;
}

export function renderCorpusReport(books: CorpusBook[], meta: { root: string; generatedAt: string }): string {
  const probed = books.filter((book) => !book.duplicateOf && !book.skipped);
  const classified = probed
    .map((book) => ({ book, findings: classifyBook(book) }))
    .sort(
      (a, b) =>
        stateRank(stateOf(a.findings)) - stateRank(stateOf(b.findings)) ||
        b.findings.filter((finding) => finding.severity !== "info").length -
          a.findings.filter((finding) => finding.severity !== "info").length ||
        a.book.relPath.localeCompare(b.book.relPath),
    );

  const tiles = DIMENSIONS.map(({ key, title }) => {
    const affected = classified.filter(({ findings }) =>
      findings.some((finding) => finding.dimension === key && finding.severity !== "info"),
    );
    const errors = affected.filter(({ findings }) =>
      findings.some((finding) => finding.dimension === key && finding.severity === "error"),
    ).length;
    return `<a class="tile" href="#d-${key}"><b>${affected.length}</b><span>${title}有问题/缺陷</span><small>${errors} 本严重</small></a>`;
  }).join("");

  const dimensionSections = DIMENSIONS.map(({ key, title, question }) => {
    const byCode = new Map<string, { severity: Severity; books: CorpusBook[] }>();
    for (const { book, findings } of classified)
      for (const finding of findings.filter((entry) => entry.dimension === key)) {
        const entry = byCode.get(finding.code) ?? { severity: finding.severity, books: [] };
        if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[entry.severity]) entry.severity = finding.severity;
        if (!entry.books.includes(book)) entry.books.push(book);
        byCode.set(finding.code, entry);
      }
    const rows = [...byCode]
      .sort(
        (a, b) => SEVERITY_RANK[a[1].severity] - SEVERITY_RANK[b[1].severity] || b[1].books.length - a[1].books.length,
      )
      .map(
        ([code, { severity, books: affected }]) => `<tr>
          <td class="issue"><span class="dot ${severity}"></span>${escape(FINDING_LABELS[code] ?? code)}</td>
          <td class="num">${affected.length}</td>
          <td>${affected.map(bookLink).join("、")}</td>
        </tr>`,
      )
      .join("");
    return `<h2 id="d-${key}">${title}</h2><p class="lede">${escape(question)}</p>
    <div class="table-wrap"><table><thead><tr><th>发现</th><th class="num">书数</th><th>涉及的书</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="3">没有发现问题</td></tr>`}</tbody></table></div>`;
  }).join("");

  const perfRows = [...classified]
    .sort((a, b) => b.book.bytes - a.book.bytes)
    .map(({ book }) => {
      const open = book.open?.ok ? book.open.summary : null;
      const first = firstPageMs(book);
      const jumps = book.samples.filter((sample) => sample.ok).slice(1);
      return `<tr>
        <td>${bookLink(book)}</td>
        <td>${escape(formatOf(book))}</td>
        <td class="num">${size(book.bytes)}</td>
        <td class="num">${open ? open.sections.toLocaleString() : "—"}</td>
        <td class="num">${open ? seconds(open.parseMs) : "—"}</td>
        <td class="num">${book.toc ? seconds(book.toc.repairMs) : "—"}</td>
        <td class="num">${first !== null ? seconds(first) : "—"}</td>
        <td class="num">${jumps.length ? seconds(Math.max(...jumps.map((sample) => sample.ms))) : "—"}</td>
        <td class="num">${book.chapters ? seconds(book.chapters.ms) : "—"}</td>
        <td class="num">${book.peakHeapBytes ? megabytes(book.peakHeapBytes) : "—"}</td>
      </tr>`;
    })
    .join("");

  const duplicates = books.filter((book) => book.duplicateOf);
  const skipped = books.filter((book) => book.skipped);
  const aside = [
    duplicates.length
      ? `<h3>重复文件（内容相同，只探测一次）</h3><ul class="plain">${duplicates
          .map((book) => `<li>${escape(book.relPath)} <span class="muted">= ${escape(book.duplicateOf)}</span></li>`)
          .join("")}</ul>`
      : "",
    skipped.length
      ? `<h3>跳过的非书文件</h3><ul class="plain">${skipped
          .map((book) => `<li>${escape(book.relPath)} <span class="muted">${escape(book.skipped)}</span></li>`)
          .join("")}</ul>`
      : "",
  ].join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>书库兼容性报告</title>
<style>
:root {
  --paper: #faf8f3; --surface: #ffffff; --ink: #1c1917; --muted: #57534e; --line: #e7e2d9; --bar: #a8a29e;
  --error: #b42318; --error-bg: #fdf0ee; --warning: #9a6700; --warning-bg: #fdf6e3; --ok: #2f6b3a; --ok-bg: #eef6ee;
  --info: #78716c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #1a1917; --surface: #22211e; --ink: #ece9e2; --muted: #b3ada3; --line: #3a3833; --bar: #6b665e;
    --error: #f38b7f; --error-bg: #3a1f1c; --warning: #e7b75b; --warning-bg: #36301e; --ok: #8cc79a; --ok-bg: #1f3223;
    --info: #a8a29e;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 40px 20px 80px; }
h1 { font: 600 30px/1.25 "Songti SC", Georgia, serif; margin: 0 0 6px; }
h2 { font: 600 21px/1.3 "Songti SC", Georgia, serif; margin: 52px 0 4px; }
h3 { font-size: 16px; margin: 0; }
h4 { font-size: 13px; margin: 0 0 6px; color: var(--muted); font-weight: 600; letter-spacing: .02em; }
.lede { color: var(--muted); margin: 0 0 16px; overflow-wrap: anywhere; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 24px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; color: inherit; text-decoration: none; }
.tile b { display: block; font: 600 28px/1.1 Georgia, serif; }
.tile span { display: block; color: var(--muted); font-size: 13px; } .tile small { color: var(--error); font-size: 12px; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 14px; }
th { font-weight: 600; color: var(--muted); font-size: 13px; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td a { color: inherit; }
td.issue { width: 15em; min-width: 11em; }
.table-wrap { overflow-x: auto; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
.dot.error { background: var(--error); } .dot.warning { background: var(--warning); } .dot.info { background: var(--info); }
.filters { display: flex; gap: 8px; margin: 0 0 16px; flex-wrap: wrap; }
.filters button { font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.book { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.book.error { border-left-color: var(--error); } .book.warning { border-left-color: var(--warning); } .book.ok, .book.info { border-left-color: var(--ok); }
.book header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.path { margin: 2px 0 0; color: var(--muted); font-size: 12px; word-break: break-all; }
.verdict { flex: none; font-size: 12px; padding: 2px 10px; border-radius: 999px; }
.verdict.error { color: var(--error); background: var(--error-bg); } .verdict.warning { color: var(--warning); background: var(--warning-bg); }
.verdict.ok, .verdict.info { color: var(--ok); background: var(--ok-bg); }
.dims { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin-top: 12px; }
.dim { border-top: 1px solid var(--line); padding-top: 10px; min-width: 0; }
.findings { list-style: none; padding: 0; margin: 0 0 6px; }
.finding { font-size: 13.5px; padding: 2px 0; color: var(--muted); word-break: break-word; }
.finding .tag { font-weight: 600; margin-right: 4px; }
.finding.error .tag { color: var(--error); } .finding.warning .tag { color: var(--warning); } .finding.info .tag { color: var(--info); }
.clean { margin: 0 0 6px; font-size: 13px; color: var(--ok); }
.metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 4px 14px; margin: 6px 0 0; }
.metric dt { font-size: 12px; color: var(--muted); } .metric dd { margin: 0; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.bars { display: flex; gap: 1px; height: 10px; margin-top: 8px; border-radius: 3px; overflow: hidden; }
.bars span { background: var(--bar); min-width: 1px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.shots figure { margin: 0; }
.shots img { width: 100%; border: 1px solid var(--line); border-radius: 5px; display: block; background: #fff; }
.shots figcaption { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.more { margin-top: 8px; font-size: 13px; } .more pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--muted); max-height: 260px; overflow: auto; }
.plain { padding-left: 18px; font-size: 13.5px; } .muted { color: var(--muted); }
@media (max-width: 760px) { main { padding: 24px 16px 60px; } h1 { font-size: 24px; } .dims { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>书库兼容性报告</h1>
  <p class="lede">${escape(meta.root)} · ${escape(new Date(meta.generatedAt).toLocaleString("zh-CN"))} · ${probed.length} 本（另有 ${duplicates.length} 个重复文件）<br>
  每本书都走 app 的真实代码：<code>parseBookFile</code> 解析、<code>ensureUsableToc</code> 修复目录、<code>readerChapterEntries</code> 分章、<code>extractBookText</code> 抽取章节文本，并在 <code>&lt;foliate-view&gt;</code> 里用默认阅读设置（双页 + 连续滚动）渲染第一章和 25/50/75%/末尾处。
  渲染跑在 Chrome（Blink）里，排版问题请在 app（WebKit）里复核；耗时不含 app 把文件经 IPC 读进 webview 的时间。</p>
  <div class="tiles">${tiles}</div>

  ${dimensionSections}

  <h2>性能明细（按文件大小）</h2>
  <p class="lede">首屏 = 建阅读视图 + 跳到第一章并完成布局；跳转 = 其余抽样位置里最慢的一次；章节抽取是后台任务（AI/搜索/纪要用）。</p>
  <div class="table-wrap"><table>
    <thead><tr><th>书</th><th>格式</th><th class="num">大小</th><th class="num">文件/页</th><th class="num">解析</th><th class="num">目录修复</th><th class="num">首屏</th><th class="num">最慢跳转</th><th class="num">章节抽取</th><th class="num">JS 堆</th></tr></thead>
    <tbody>${perfRows}</tbody>
  </table></div>

  <h2>逐本明细</h2>
  <div class="filters" role="group" aria-label="筛选">
    <button type="button" data-filter="all" aria-pressed="true">全部</button>
    <button type="button" data-filter="error" aria-pressed="false">有问题</button>
    <button type="button" data-filter="warning" aria-pressed="false">有缺陷</button>
    <button type="button" data-filter="ok" aria-pressed="false">正常</button>
  </div>
  <div id="books">${classified.map(({ book, findings }) => bookCard(book, findings)).join("\n")}</div>

  ${aside ? `<h2>其他文件</h2>${aside}` : ""}
</main>
<script>
for (const button of document.querySelectorAll("[data-filter]")) {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    for (const other of document.querySelectorAll("[data-filter]")) other.setAttribute("aria-pressed", String(other === button));
    for (const book of document.querySelectorAll(".book")) book.hidden = filter !== "all" && filter !== book.dataset.state;
  });
}
</script>
</body>
</html>`;
}
