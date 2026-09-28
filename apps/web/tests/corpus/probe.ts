/**
 * Page entry for the book corpus probe (`tests/corpus/index.html`), driven step by step
 * by `scripts/run-corpus-probe.ts`. It answers four questions per book, each through the
 * app's own code path:
 *
 * 1. TOC — what the parser (`parseBookFile`) extracts, what `ensureUsableToc` repairs,
 *    and whether every entry resolves.
 * 2. Chapters — whether the chapter entries the reader and the text extractor split by
 *    (`readerChapterEntries`) partition the book in order, whether each target opens
 *    with its label, and the chapter sizes `extractBookText` actually produces.
 * 3. Rendering — sampled sections in `<foliate-view>` with the reader's default layout
 *    and stylesheet, in paginated and scrolled flow: load failures, broken images,
 *    content wider than the text column, unreadably small text (screenshots are taken
 *    and measured by the runner).
 * 4. Performance — parse, TOC repair, first page, section jumps and full extraction.
 *
 * The page loads app modules, so it must not claim to be Tauri: no `__TAURI_INTERNALS__`
 * marker here, which keeps the logger and IPC seams on their browser paths.
 */
import { errorCode } from "@read-aware/core";
import { sniffBookFormat } from "../../src/features/library/lib/book-format-sniff";
import { extractBookText } from "../../src/features/library/lib/book-text-extraction";
import { snapshotFromText, type BookTextRecord } from "../../src/features/library/lib/book-text-record";
import { formatFromName } from "../../src/features/library/lib/import-format";
import {
  createFoliateView,
  foliateTitle,
  isFixedLayout,
  type FoliateBook,
  type FoliateLoadDetail,
  type FoliateResolved,
  type FoliateTocItem,
  type FoliateView,
} from "../../src/features/reader/lib/foliate-engine";
import { parseBookFile } from "../../src/features/reader/lib/parse-book";
import {
  markReaderChapterStarts,
  normalizeReaderTextSizes,
  prepareReaderChapterStarts,
  readerChapterEntries,
} from "../../src/features/reader/lib/reader-document-layout";
import { ensureUsableToc } from "../../src/features/reader/lib/toc-synthesis";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  layoutForReadingMode,
  readerLayoutSpacing,
} from "../../src/features/settings/lib/reader-css";
import {
  DEFAULT_READER_SETTINGS,
  type ReaderSettings,
  type ReadingMode,
} from "../../src/features/settings/lib/reader-settings";
import { resolveReaderPalette } from "../../src/features/settings/lib/reader-theme";
import { chapterStructure, isCheckableLabel, labelMatches, type ChapterLayout, type Position } from "./chapter-checks";
import type {
  ChapterSummary,
  CorpusProbeApi,
  LabelMismatch,
  OpenResult,
  Overflow,
  RenderSample,
  RenderSetup,
  RenderTarget,
  TocSummary,
} from "./probe-types";

/** Formats the probe opens when the name alone does not route the file. Text and HTML
 * sniffs are left out: any UTF-8 note or JSON file next to the books would qualify. */
const SNIFFABLE_BOOKS = new Set(["epub", "pdf", "mobi", "azw3", "fb2", "cbz", "cbr"]);
const IMAGE_SETTLE_MS = 5000;
const PDF_RENDER_MS = 20_000;
const LABEL_SAMPLE_CHAPTERS = 60;
const LABEL_SAMPLE_NESTED = 40;
const TINY_TEXT_PX = 10.5;
const MAX_TEXT_NODES = 8000;
const MAX_OVERFLOW_ELEMENTS = 20_000;

let book: FoliateBook | null = null;
let format: string | null = null;
let view: FoliateView | null = null;
let fixedLayout = false;
let mode: ReadingMode = DEFAULT_READER_SETTINGS.readingMode;
let chapterStarts: Awaited<ReturnType<typeof prepareReaderChapterStarts>> = new Map();
let sourceToc: { entries: number; depth: number } = { entries: 0, depth: 0 };

const message = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const nonWhitespace = (text: string) => text.replace(/\s+/gu, "").length;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function tocShape(items: readonly FoliateTocItem[], depth = 1): { entries: number; depth: number } {
  let entries = 0,
    deepest = items.length ? depth : 0;
  for (const item of items) {
    entries++;
    const nested = tocShape(item.subitems ?? [], depth + 1);
    entries += nested.entries;
    deepest = Math.max(deepest, nested.depth);
  }
  return { entries, depth: deepest };
}

function opened(): FoliateBook {
  if (!book) throw new Error("No book is open");
  return book;
}

async function open(input: { url: string; name: string; sniffOnly: boolean }) {
  const readStarted = performance.now();
  const response = await fetch(input.url);
  if (!response.ok) throw new Error(`Corpus file request failed: ${response.status}`);
  const file = new File([await response.blob()], input.name);
  const readMs = performance.now() - readStarted;
  let formatHint = formatFromName(input.name, file.type);
  let sniffed = false;
  if (!formatHint) {
    formatHint = await sniffBookFormat(file);
    sniffed = true;
    if (input.sniffOnly && (!formatHint || !SNIFFABLE_BOOKS.has(formatHint)))
      return { ok: false as const, skipped: formatHint ? `sniffed as ${formatHint}` : "no book format detected" };
  }
  format = formatHint;
  const started = performance.now();
  try {
    const parsed = await parseBookFile(file);
    const parseMs = performance.now() - started;
    book = parsed;
    fixedLayout = isFixedLayout(parsed);
    // Measured before `toc()` runs the app's repair on it.
    sourceToc = tocShape(parsed.toc ?? []);
    return {
      ok: true,
      summary: {
        formatHint,
        sniffed,
        bytes: file.size,
        readMs,
        parseMs,
        title: foliateTitle(parsed),
        fixedLayout,
        writingMode: parsed.dir ?? null,
        sections: parsed.sections.length,
        linearSections: parsed.sections.filter((section) => section.linear !== "no").length,
      },
    } satisfies OpenResult;
  } catch (error) {
    // Same classification as `domain/book-inspection.ts`.
    const code = errorCode(error);
    const encrypted =
      code === "book/unsupported-encryption" || (error instanceof Error && error.name === "PasswordException");
    return {
      ok: false,
      failure: {
        formatHint,
        sniffed,
        bytes: file.size,
        status: encrypted ? "encrypted" : code === "book/unsupported-format" ? "unsupported" : "failed",
        errorCode: encrypted ? "book/unsupported-encryption" : (code ?? "book/parse-failed"),
        message: message(error),
      },
    } satisfies OpenResult;
  }
}

// ---- 1 + 2: TOC and chapter structure ----------------------------------------

/** Section documents for positions and label checks, bounded so a 2000-file book stays small. */
class SectionDocuments {
  #docs = new Map<number, Promise<Document | null>>();
  constructor(private parsed: FoliateBook) {}
  get(index: number): Promise<Document | null> {
    let doc = this.#docs.get(index);
    if (!doc) {
      const section = this.parsed.sections[index];
      const create = section?.createDocument;
      doc = create
        ? Promise.resolve()
            .then(() => create())
            // A section that cannot load fails the chapter extraction step, which reports it;
            // here it only means no position or text to compare.
            .catch(() => null)
        : Promise.resolve(null);
      this.#docs.set(index, doc);
      if (this.#docs.size > 24) this.#docs.delete(this.#docs.keys().next().value!);
    }
    return doc;
  }
}

function anchorIn(target: FoliateResolved, doc: Document) {
  return (typeof target.anchor === "function" ? target.anchor(doc) : target.anchor) ?? null;
}

/** Characters from the section start to the target; 0 for a section start. */
async function offsetOf(target: FoliateResolved, docs: SectionDocuments): Promise<number> {
  if (target.anchor == null || target.anchor === 0) return 0;
  const doc = await docs.get(target.index);
  if (!doc?.body) return typeof target.anchor === "number" ? Math.round(target.anchor * 1e6) : 0;
  const anchor = anchorIn(target, doc);
  if (anchor == null) return 0;
  const before = doc.createRange();
  before.selectNodeContents(doc.body);
  if (typeof anchor === "number") return Math.round(anchor * before.toString().length);
  if ("startContainer" in anchor) before.setEnd(anchor.startContainer, anchor.startOffset);
  else if (anchor === doc.body || anchor === doc.documentElement) return 0;
  else before.setEndBefore(anchor);
  return before.toString().length;
}

/**
 * The text a reader sees at the target — from the anchor on, or the whole page for page-text
 * sections — and whether it opens with a picture instead (an image heading or a title-page
 * scan), in which case the label cannot be checked against text.
 */
async function textAt(target: FoliateResolved, docs: SectionDocuments): Promise<{ text: string; pictured: boolean }> {
  const section = opened().sections[target.index];
  if (!section) return { text: "", pictured: false };
  if (section.getText) {
    const text = (await section.getText()).slice(0, 3000);
    return { text, pictured: !text.trim() };
  }
  const doc = await docs.get(target.index);
  if (!doc?.body) return { text: "", pictured: false };
  const anchor = anchorIn(target, doc);
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  if (anchor && typeof anchor !== "number" && anchor !== doc.body && anchor !== doc.documentElement) {
    if ("startContainer" in anchor) range.setStart(anchor.startContainer, anchor.startOffset);
    else range.setStartBefore(anchor);
  }
  const text = range.toString().trimStart().slice(0, 400);
  const picture = [...doc.body.querySelectorAll("img, svg, image")].find(
    (element) => range.comparePoint(element, 0) >= 0,
  );
  let pictured = !text.trim();
  if (picture && !pictured) {
    const before = range.cloneRange();
    before.setEndBefore(picture);
    pictured = nonWhitespace(before.toString()) < 10;
  }
  return { text, pictured };
}

const evenly = <T>(items: T[], count: number) =>
  items.length <= count
    ? items
    : Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]!);

async function toc(): Promise<TocSummary> {
  const started = performance.now();
  const parsed = opened();
  const repairStarted = performance.now();
  const changed = await ensureUsableToc(parsed);
  const repairMs = performance.now() - repairStarted;
  const repaired = tocShape(parsed.toc ?? []);
  const repair = !changed ? "none" : repaired.entries > sourceToc.entries ? "synthesized" : "relocated";

  const resolveCache = new Map<string, Promise<FoliateResolved | null>>();
  const resolve = (href: string) => {
    let target = resolveCache.get(href);
    if (!target) {
      target = Promise.resolve()
        .then(() => parsed.resolveHref?.(href))
        .then((resolved) => (resolved && parsed.sections[resolved.index] ? resolved : null))
        // A throwing resolver is an unresolvable entry, which the caller counts and reports.
        .catch(() => null);
      resolveCache.set(href, target);
    }
    return target;
  };
  const labels = new Map<string, string>();
  let emptyLabels = 0;
  const walk = (items: readonly FoliateTocItem[]) => {
    for (const item of items) {
      if (!item.label?.trim()) emptyLabels++;
      else if (item.href && !labels.has(item.href)) labels.set(item.href, item.label.trim());
      walk(item.subitems ?? []);
    }
  };
  walk(parsed.toc ?? []);

  const entries = readerChapterEntries(parsed.toc ?? []);
  const allHrefs = [...new Set(entries.flatMap((entry) => [entry.href, ...entry.aliases]))];
  const unresolvedSamples: string[] = [];
  let unresolved = 0;
  for (const href of allHrefs)
    if (!(await resolve(href))) {
      unresolved++;
      if (unresolvedSamples.length < 5) unresolvedSamples.push(`${labels.get(href) ?? ""} → ${href}`);
    }

  // Positions matter only where a chapter starts; other sections compare by index alone.
  const docs = new SectionDocuments(parsed);
  const startIndexes = new Set<number>();
  for (const entry of entries) {
    const target = await resolve(entry.href);
    if (target) startIndexes.add(target.index);
  }
  const position = async (target: FoliateResolved): Promise<Position> => ({
    index: target.index,
    offset: startIndexes.has(target.index) ? await offsetOf(target, docs) : 0,
  });
  const layouts: ChapterLayout[] = [];
  let nonLinear = 0;
  for (const entry of entries) {
    const start = await resolve(entry.href);
    if (start && parsed.sections[start.index]!.linear === "no") nonLinear++;
    const children: ChapterLayout["children"] = [];
    for (const alias of entry.aliases) {
      const target = await resolve(alias);
      if (target) children.push({ ...(await position(target)), label: labels.get(alias) ?? alias });
    }
    layouts.push({ label: entry.title ?? entry.href, start: start ? await position(start) : null, children });
  }
  const structure = chapterStructure(layouts);

  let labelChecked = 0,
    labelMatched = 0,
    labelPictured = 0;
  const mismatches: LabelMismatch[] = [];
  const nested = entries.flatMap((entry) => entry.aliases);
  const sample = [
    ...evenly(
      entries.map((entry) => entry.href),
      LABEL_SAMPLE_CHAPTERS,
    ),
    ...evenly(nested, LABEL_SAMPLE_NESTED),
  ];
  for (const href of sample) {
    const label = labels.get(href);
    const target = await resolve(href);
    if (!label || !target || !isCheckableLabel(label)) continue;
    // A target that cannot be read counts as a mismatch: the reader lands on nothing.
    const { text: found, pictured } = await textAt(target, docs).catch(() => ({ text: "", pictured: false }));
    if (pictured) {
      labelPictured++;
      continue;
    }
    labelChecked++;
    if (labelMatches(label, found)) labelMatched++;
    else if (mismatches.length < 6) mismatches.push({ label, found: found.replace(/\s+/gu, " ").slice(0, 80) });
  }

  return {
    sourceEntries: sourceToc.entries,
    sourceDepth: sourceToc.depth,
    entries: repaired.entries,
    repair,
    repairMs,
    emptyLabels,
    unresolved,
    unresolvedSamples,
    chapterEntries: entries.length,
    nonLinear,
    ...structure,
    labelChecked,
    labelMatched,
    labelPictured,
    mismatches,
    chapterNested: entries.slice(0, 2000).map((entry) => ({ title: entry.title ?? "", nested: entry.aliases.length })),
    ms: performance.now() - started,
  };
}

async function chapters(budgetMs: number): Promise<ChapterSummary> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Text budget elapsed", "TimeoutError")), budgetMs);
  let latest: BookTextRecord | null = null;
  let slowestSectionMs = 0;
  let error: string | null = null;
  try {
    latest = await extractBookText(opened(), {
      bookId: "corpus-probe",
      contentVersion: "corpus-probe",
      prior: null,
      signal: controller.signal,
      yieldToReader: async () => {},
      readSection: async (read) => {
        const sectionStarted = performance.now();
        try {
          return await read();
        } finally {
          slowestSectionMs = Math.max(slowestSectionMs, performance.now() - sectionStarted);
        }
      },
      save: async (record) => {
        latest = record;
      },
      progress: () => {},
      warn: (warning, cause) => console.warn(`[corpus-probe] ${warning}`, cause),
    });
  } catch (cause) {
    if (!controller.signal.aborted) error = message(cause);
  } finally {
    clearTimeout(timer);
  }
  const record = latest as BookTextRecord | null;
  const snapshot = record ? snapshotFromText(record) : null;
  return {
    status: snapshot?.status ?? "unsupported",
    text: snapshot?.text ?? "unknown",
    timedOut: controller.signal.aborted,
    required: record?.required.length ?? 0,
    completed: record?.pieces.length ?? 0,
    failed: record?.failures.length ?? 0,
    failureCodes: [...new Set(record?.failures.map((failure) => failure.code) ?? [])],
    chars: (record?.pieces ?? []).reduce((total, piece) => total + nonWhitespace(piece.text), 0),
    chapters: (record?.chapters ?? []).map((chapter) => ({
      title: chapter.title ?? "",
      chars: nonWhitespace(chapter.text),
    })),
    ms: performance.now() - started,
    slowestSectionMs,
    error,
  };
}

// ---- 3 + 4: rendering and navigation ---------------------------------------

/** The desktop reader's defaults, with a system font so no curated font asset gates layout. */
function readerSettings(): ReaderSettings {
  return { ...DEFAULT_READER_SETTINGS, fontFamily: "system:serif" };
}

async function prepareRender(requested?: string): Promise<RenderSetup> {
  const started = performance.now();
  const parsed = opened();
  const settings = readerSettings();
  mode =
    (requested as ReadingMode | undefined) ?? (fixedLayout ? settings.fixedLayoutReadingMode : settings.readingMode);
  try {
    if (view) {
      await view.close();
      view.remove();
      view = null;
    }
    chapterStarts = await prepareReaderChapterStarts(parsed);
    const stage = document.getElementById("stage")!;
    const next = await createFoliateView();
    next.style.cssText = "display:block;width:100%;height:100%";
    // The reader's workspace shows the palette behind the page margins, not white.
    stage.style.background = resolveReaderPalette(settings.theme, []).bg;
    stage.replaceChildren(next);
    view = next;
    next.addEventListener("load", (event) => {
      if (fixedLayout) return;
      const { doc, index } = (event as CustomEvent<FoliateLoadDetail>).detail;
      markReaderChapterStarts(doc, index, chapterStarts);
      normalizeReaderTextSizes(doc);
    });
    await next.open(parsed);
    const renderer = next.renderer;
    if (!renderer) throw new Error("The view opened without a renderer");
    if ("setChapterStarts" in renderer) renderer.setChapterStarts(chapterStarts);
    const { flow, maxColumnCount } = layoutForReadingMode(mode);
    if (fixedLayout && "setLayout" in renderer) renderer.setLayout(flow, maxColumnCount);
    else if ("setLayoutAttributes" in renderer)
      renderer.setLayoutAttributes({ flow, "max-column-count": String(maxColumnCount) });
    const { width, height } = stage.getBoundingClientRect();
    const columns = width > height ? maxColumnCount : 1;
    const { gap, margin } = readerLayoutSpacing(settings.pageMargins, mode);
    if ("setLayoutAttributes" in renderer)
      renderer.setLayoutAttributes({
        gap,
        margin,
        "max-inline-size": `${computeReaderMaxInlineSize(width, settings.pageMargins, columns)}px`,
      });
    if ("setStyles" in renderer)
      renderer.setStyles(
        buildReaderContentCss(
          { ...settings, readingMode: mode },
          { palette: resolveReaderPalette(settings.theme, []) },
        ),
      );
    return { ok: true, mode, ms: performance.now() - started, error: null, targets: await renderTargets(parsed) };
  } catch (error) {
    return { ok: false, mode, ms: performance.now() - started, error: message(error), targets: [] };
  }
}

/** Where a reader lands: the first chapter, then quarter points through the book. */
async function renderTargets(parsed: FoliateBook): Promise<RenderTarget[]> {
  const linear = parsed.sections.flatMap((section, index) => (section.linear === "no" ? [] : [index]));
  const targets: RenderTarget[] = [];
  for (const entry of readerChapterEntries(parsed.toc ?? []).slice(0, 3)) {
    try {
      const resolved = await parsed.resolveHref?.(entry.href);
      if (resolved && parsed.sections[resolved.index]) {
        targets.push({ label: "第一章", target: entry.href, index: resolved.index });
        break;
      }
    } catch {
      // An unresolvable entry is counted by the TOC step; try the next one.
    }
  }
  if (!targets.length && linear.length) targets.push({ label: "开头", target: linear[0]!, index: linear[0]! });
  for (const [label, fraction] of [
    ["25%", 0.25],
    ["50%", 0.5],
    ["75%", 0.75],
    ["末尾", 1],
  ] as const) {
    const index = linear[Math.min(linear.length - 1, Math.floor(fraction * linear.length))];
    if (index !== undefined && !targets.some((target) => target.index === index))
      targets.push({ label, target: index, index });
  }
  return targets;
}

async function settleImages(doc: Document): Promise<HTMLImageElement[]> {
  const images = [...doc.images];
  await Promise.race([
    Promise.all(
      images.map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, IMAGE_SETTLE_MS)),
  ]);
  return images;
}

/** Outermost elements wider than the text column; their descendants are not reported again. */
function findOverflows(doc: Document, scrolled: boolean): Overflow[] {
  const win = doc.defaultView;
  if (!win || !doc.body) return [];
  const html = doc.documentElement;
  if (win.getComputedStyle(html).writingMode.startsWith("vertical")) return [];
  const limit = scrolled
    ? doc.body.getBoundingClientRect().width
    : parseFloat(html.style.getPropertyValue("column-width")) || html.getBoundingClientRect().width;
  const overflows: Overflow[] = [];
  const flagged: Element[] = [];
  let seen = 0;
  for (const element of doc.body.querySelectorAll("*")) {
    if (++seen > MAX_OVERFLOW_ELEMENTS) break;
    if (flagged.some((ancestor) => ancestor.contains(element))) continue;
    // Per fragment: an element broken across columns has one client rect per column,
    // and its bounding box spans them all.
    let width = 0;
    for (const rect of element.getClientRects()) width = Math.max(width, rect.width);
    if (width <= limit + 2) continue;
    flagged.push(element);
    if (overflows.length < 5)
      overflows.push({ tag: element.tagName.toLowerCase(), width: Math.round(width), limit: Math.round(limit) });
  }
  return overflows;
}

function tinyTextShare(doc: Document): number {
  const win = doc.defaultView;
  if (!win || !doc.body) return 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let total = 0,
    tiny = 0,
    nodes = 0;
  for (let node = walker.nextNode(); node && nodes < MAX_TEXT_NODES; node = walker.nextNode(), nodes++) {
    const length = nonWhitespace(node.textContent ?? "");
    if (!length || !node.parentElement) continue;
    total += length;
    if (parseFloat(win.getComputedStyle(node.parentElement).fontSize) < TINY_TEXT_PX) tiny += length;
  }
  return total ? tiny / total : 0;
}

async function render(target: RenderTarget): Promise<RenderSample> {
  const started = performance.now();
  const sample: RenderSample = {
    mode,
    label: target.label,
    index: target.index,
    ok: false,
    ms: 0,
    error: null,
    textChars: null,
    pages: null,
    images: 0,
    brokenImages: 0,
    brokenImageSamples: [],
    overflows: [],
    tinyTextShare: 0,
  };
  try {
    if (!view?.renderer) throw new Error("The view is not prepared");
    const renderer = view.renderer;
    // Only PDF pages rasterize lazily after navigation; other fixed layouts are laid out when goTo settles.
    const rasterized =
      fixedLayout && format === "pdf"
        ? new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Page ${target.index} did not render in ${PDF_RENDER_MS} ms`)),
              PDF_RENDER_MS,
            );
            renderer.addEventListener("rendered", function onRendered(event) {
              if ((event as CustomEvent<{ index: number }>).detail?.index !== target.index) return;
              clearTimeout(timer);
              renderer.removeEventListener("rendered", onRendered);
              resolve();
            });
          })
        : null;
    await view.goTo(target.target);
    await rasterized;
    const content = renderer.getContents().find((entry) => entry.index === target.index);
    if (!content) throw new Error(`Section ${target.index} is not among the rendered contents`);
    const doc = content.doc;
    await doc.fonts.ready;
    const images = await settleImages(doc);
    await nextFrame();
    await nextFrame();
    sample.ms = performance.now() - started;
    const broken = images.filter((image) => image.complete && image.naturalWidth === 0);
    sample.images = images.length;
    sample.brokenImages = broken.length;
    sample.brokenImageSamples = broken.slice(0, 3).map((image) => image.getAttribute("src") ?? "");
    const section = opened().sections[target.index];
    // A fixed-layout page's text layer tells a blank page from one that failed to paint.
    if (fixedLayout && section?.getText) sample.textChars = nonWhitespace(await section.getText());
    if (!fixedLayout) {
      sample.textChars = nonWhitespace(doc.body?.innerText ?? "");
      sample.overflows = findOverflows(doc, mode === "scroll");
      sample.tinyTextShare = tinyTextShare(doc);
      if ("pages" in renderer) sample.pages = renderer.pages;
    }
    sample.ok = true;
  } catch (error) {
    sample.error = message(error);
    sample.ms = performance.now() - started;
  }
  return sample;
}

function stageRect() {
  const { x, y, width, height } = document.getElementById("stage")!.getBoundingClientRect();
  return { x, y, width, height };
}

async function ink(dataUrl: string): Promise<number> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  // The background is the most common color; anything clearly different is ink.
  const counts = new Map<number, number>();
  const key = (offset: number) =>
    ((data[offset]! >> 3) << 10) | ((data[offset + 1]! >> 3) << 5) | (data[offset + 2]! >> 3);
  for (let offset = 0; offset < data.length; offset += 16) counts.set(key(offset), (counts.get(key(offset)) ?? 0) + 1);
  const background = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  const channel = (value: number, shift: number) => ((value >> shift) & 31) << 3;
  const [r, g, b] = [channel(background, 10), channel(background, 5), channel(background, 0)];
  let inked = 0,
    total = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    total++;
    const distance = Math.abs(data[offset]! - r) + Math.abs(data[offset + 1]! - g) + Math.abs(data[offset + 2]! - b);
    if (distance > 48) inked++;
  }
  return total ? inked / total : 0;
}

async function close(): Promise<void> {
  await view?.close();
  view?.remove();
  view = null;
  await book?.destroy?.();
  book = null;
}

window.corpusProbe = { open, toc, prepareRender, render, stageRect, ink, chapters, close } satisfies CorpusProbeApi;
