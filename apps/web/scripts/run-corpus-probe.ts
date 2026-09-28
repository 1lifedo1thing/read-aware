/**
 * Probe a folder of real books for reader compatibility, without importing them one by one.
 *
 *   bun scripts/run-corpus-probe.ts ~/Downloads/books                 # from apps/web
 *   bun scripts/run-corpus-probe.ts <dir> --out <dir> --jobs 3 --only 三体 --text-budget 300
 *
 * Every book runs in its own page of a headless Chrome against the web dev server
 * (`tests/corpus/probe.ts`) and is judged on four questions: is the TOC extracted, do its
 * entries separate the chapters correctly, do sampled sections render without layout
 * defects (paginated and scrolled; screenshots measured for blank pages), and how long do
 * parsing, the first page, jumps and full-text chapter extraction take. Byte-identical files
 * are probed once.
 *
 * Output: `results.json`, `report.html` and page screenshots under the output directory
 * (default: a fresh folder in the system temp directory, printed at the end).
 *
 * Chrome (Blink) is the scriptable parity run. The shipping macOS/iOS engine is WebKit:
 * confirm layout findings in the running app before treating them as WebKit behavior.
 * Timings exclude the app's IPC transfer of the file into the webview.
 */
import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK_IMPORT_FORMATS } from "@read-aware/core";
import { createServer, type Plugin } from "vite";
import type { ChapterSummary, OpenResult, RenderSample, RenderSetup, TocSummary } from "../tests/corpus/probe-types";
import { classifyBook, renderCorpusReport, type ConsoleEntry, type CorpusBook } from "./corpus-report";
import { launchHeadlessChrome, type DevTools, type HeadlessChrome } from "./headless-chrome";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Options = {
  dir: string;
  out: string;
  jobs: number;
  only: string | null;
  textBudgetMs: number;
};

function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith("--")) flags.set(arg, argv[++index] ?? "");
    else positional.push(arg);
  }
  const dir = positional[0];
  if (!dir) {
    console.error("usage: bun scripts/run-corpus-probe.ts <books dir> [--out dir] [--jobs n] [--only text]");
    console.error("       [--text-budget seconds]");
    process.exit(2);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    dir: resolve(dir),
    out: resolve(flags.get("--out") ?? join(tmpdir(), "readaware-corpus-probe", stamp)),
    jobs: Math.max(1, Number(flags.get("--jobs") ?? 2)),
    only: flags.get("--only") ?? null,
    textBudgetMs: Math.max(10, Number(flags.get("--text-budget") ?? 300)) * 1000,
  };
}

const BOOK_EXTENSIONS = new Set(BOOK_IMPORT_FORMATS.flatMap((entry) => entry.extensions));
/** Browser download leftovers and the probe's own notes are never books. */
const NEVER_BOOKS = new Set(["crdownload", "part", "download", "json", "md", "zip", "ds_store"]);

/** Every file under `dir`, following symlinks (libraries are often linked in). */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".")) return [];
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat?.isDirectory() ? walk(path) : stat?.isFile() ? [path] : [];
  });
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk as Buffer);
  return hasher.digest("hex");
}

/** Serves `/__corpus/<id>` from the files under test, streamed from disk. */
function corpusFiles(paths: Map<string, string>): Plugin {
  return {
    name: "readaware-corpus-files",
    configureServer(server) {
      server.middlewares.use("/__corpus/", (request, response) => {
        const id = decodeURIComponent((request.url ?? "").replace(/^\//, "").split("?")[0]!);
        const path = paths.get(id);
        if (!path) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", String(statSync(path).size));
        createReadStream(path).pipe(response);
      });
    },
  };
}

class StepTimeout extends Error {}

/** Messages every book produces because of how the engine is built, not because of the book. */
const ENGINE_WIDE_MESSAGES = [/both allow-scripts and allow-same-origin for its sandbox attribute/];

type Page = { chrome: HeadlessChrome; targetId: string; sessionId: string };

async function evaluate<T>(page: Page, expression: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout(`timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  });
  try {
    const { result, exceptionDetails } = await Promise.race([
      page.chrome.devtools.send<{
        result: { value?: unknown };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, page.sessionId),
      timeout,
    ]);
    if (exceptionDetails)
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? "evaluation failed");
    return result.value as T;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForProbe(page: Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(page, "!!window.corpusProbe", 10_000)) return;
    await Bun.sleep(200);
  }
  throw new Error("The probe page did not initialize");
}

function collectConsole(devtools: DevTools, sessionId: string, into: ConsoleEntry[], state: { crashed: boolean }) {
  const push = (entry: ConsoleEntry) => {
    if (ENGINE_WIDE_MESSAGES.some((pattern) => pattern.test(entry.text))) return;
    if (into.length < 60) into.push({ ...entry, text: entry.text.slice(0, 600) });
  };
  return devtools.on((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.method === "Runtime.exceptionThrown") {
      const { exceptionDetails } = event.params as {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      push({
        level: "exception",
        text: exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? "exception",
      });
    } else if (event.method === "Runtime.consoleAPICalled") {
      const { type, args } = event.params as {
        type: string;
        args?: { value?: string | number | boolean | null; description?: string }[];
      };
      if (type !== "error" && type !== "warning") return;
      // Primitives arrive by value; objects and errors only carry a description.
      const text = (args ?? [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? "")))
        .join(" ");
      push({ level: type, text });
    } else if (event.method === "Log.entryAdded") {
      const { entry } = event.params as { entry: { level: string; text: string; url?: string } };
      if (entry.level !== "error" && entry.level !== "warning") return;
      push({ level: entry.level, text: `${entry.text}${entry.url ? ` (${entry.url})` : ""}` });
    } else if (event.method === "Inspector.targetCrashed") {
      state.crashed = true;
    }
  });
}

/** Below this share of inked pixels a page counts as blank. */
const BLANK_INK = 0.002;
/** A page that paints late is a slow page, not a blank one: look once more after this long. */
const LATE_PAINT_MS = 500;

/** One capture is both measured and saved, so the report shows exactly what was judged. */
async function screenshot(page: Page, book: CorpusBook, sample: RenderSample, out: string, position: number) {
  const rect = await evaluate<{ x: number; y: number; width: number; height: number }>(
    page,
    "window.corpusProbe.stageRect()",
    10_000,
  );
  const capture = async () => {
    const { data } = await page.chrome.devtools.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "jpeg", quality: 70, clip: { ...rect, scale: 0.5 } },
      page.sessionId,
    );
    const ink = await evaluate<number>(
      page,
      `window.corpusProbe.ink(${JSON.stringify(`data:image/jpeg;base64,${data}`)})`,
      30_000,
    );
    return { data, ink };
  };
  let shot = await capture();
  if (shot.ink < BLANK_INK) {
    await Bun.sleep(LATE_PAINT_MS);
    shot = await capture();
  }
  sample.ink = shot.ink;
  const file = `shots/${book.id}-${position}.jpg`;
  writeFileSync(join(out, file), Buffer.from(shot.data, "base64"));
  sample.shot = file;
}

/** Peak JS heap of the page across the book's steps. */
async function sampleHeap(page: Page, book: CorpusBook): Promise<void> {
  try {
    const { metrics } = await page.chrome.devtools.send<{ metrics: { name: string; value: number }[] }>(
      "Performance.getMetrics",
      {},
      page.sessionId,
    );
    const used = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
    if (used !== undefined) book.peakHeapBytes = Math.max(book.peakHeapBytes ?? 0, used);
  } catch (error) {
    // A missing sample only leaves the memory column blank for this book.
    console.warn(`heap sample for ${book.id} failed`, error);
  }
}

async function probeBook(chrome: HeadlessChrome, origin: string, book: CorpusBook, options: Options): Promise<void> {
  const started = performance.now();
  const { targetId, sessionId } = await chrome.newPage();
  const page: Page = { chrome, targetId, sessionId };
  const state = { crashed: false };
  const unsubscribe = collectConsole(chrome.devtools, sessionId, book.console, state);
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T | undefined> => {
    if (book.abandoned) return undefined;
    try {
      return await run();
    } catch (error) {
      book.stepErrors.push({
        step: name,
        error: state.crashed ? "page crashed" : error instanceof Error ? error.message : String(error),
        timeout: error instanceof StepTimeout,
      });
      // A timed-out or crashed page may still be busy; nothing after it is trustworthy.
      if (error instanceof StepTimeout || state.crashed) book.abandoned = true;
      return undefined;
    }
  };
  try {
    await Promise.all(
      ["Runtime.enable", "Log.enable", "Page.enable", "Inspector.enable", "Performance.enable"].map((method) =>
        chrome.devtools.send(method, {}, sessionId),
      ),
    );
    // The viewport must hold the whole 1280×860 stage, or screenshots clip past it.
    await chrome.devtools.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await step("load", async () => {
      await chrome.devtools.send("Page.navigate", { url: new URL("tests/corpus/index.html", origin).href }, sessionId);
      await waitForProbe(page);
    });
    const opened = await step("open", () =>
      evaluate<OpenResult | { ok: false; skipped: string }>(
        page,
        `window.corpusProbe.open(${JSON.stringify({ url: `/__corpus/${book.id}`, name: book.name, sniffOnly: book.sniffOnly })})`,
        180_000,
      ),
    );
    if (opened && "skipped" in opened) {
      book.skipped = opened.skipped;
      return;
    }
    book.open = opened;
    if (!opened?.ok) return;
    await sampleHeap(page, book);
    book.toc = await step("toc", () => evaluate<TocSummary>(page, "window.corpusProbe.toc()", 180_000));
    // The reader's default mode for the book, then continuous scroll for reflowable books.
    const modes: (string | undefined)[] = [undefined, ...(opened.summary.fixedLayout ? [] : ["scroll"])];
    for (const mode of modes) {
      const setup = await step(`render setup ${mode ?? "default"}`, () =>
        evaluate<RenderSetup>(page, `window.corpusProbe.prepareRender(${JSON.stringify(mode)})`, 90_000),
      );
      if (!setup) continue;
      book.renders.push(setup);
      for (const target of setup.ok ? setup.targets : []) {
        const sample = await step(`render ${setup.mode} ${target.label}`, () =>
          evaluate<RenderSample>(page, `window.corpusProbe.render(${JSON.stringify(target)})`, 60_000),
        );
        if (!sample) continue;
        book.samples.push(sample);
        if (sample.ok)
          await step(`screenshot ${setup.mode} ${target.label}`, () =>
            screenshot(page, book, sample, options.out, book.samples.length - 1),
          );
      }
      await sampleHeap(page, book);
    }
    book.chapters = await step("chapters", () =>
      evaluate<ChapterSummary>(
        page,
        `window.corpusProbe.chapters(${options.textBudgetMs})`,
        options.textBudgetMs + 60_000,
      ),
    );
    await sampleHeap(page, book);
    await step("close", () => evaluate<void>(page, "window.corpusProbe.close()", 30_000));
  } finally {
    unsubscribe();
    book.crashed = state.crashed;
    book.totalMs = performance.now() - started;
    await chrome.closePage(targetId).catch((error) => console.warn(`closing the page for ${book.id} failed`, error));
  }
}

function describe(book: CorpusBook): string {
  if (book.duplicateOf) return `duplicate of ${book.duplicateOf}`;
  if (book.skipped) return `skipped: ${book.skipped}`;
  const findings = classifyBook(book);
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  return `${errors} error, ${warnings} warning · ${Math.round((book.totalMs ?? 0) / 1000)} s`;
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  mkdirSync(join(options.out, "shots"), { recursive: true });

  const files = walk(options.dir)
    .filter((path) => !NEVER_BOOKS.has(extname(path).slice(1).toLowerCase()))
    .filter((path) => !options.only || relative(options.dir, path).includes(options.only))
    .sort();
  console.log(`Hashing ${files.length} files under ${options.dir}…`);
  const books: CorpusBook[] = [];
  const bySha = new Map<string, CorpusBook>();
  for (const path of files) {
    const sha = await sha256(path);
    const name = basename(path);
    const lower = name.toLowerCase();
    const book: CorpusBook = {
      id: sha.slice(0, 12),
      path,
      relPath: relative(options.dir, path),
      name,
      bytes: statSync(path).size,
      sha256: sha,
      sniffOnly: ![...BOOK_EXTENSIONS].some((extension) => lower.endsWith(`.${extension}`)),
      renders: [],
      samples: [],
      console: [],
      stepErrors: [],
    };
    const original = bySha.get(sha);
    if (original) book.duplicateOf = original.relPath;
    else bySha.set(sha, book);
    books.push(book);
  }
  const queue = books.filter((book) => !book.duplicateOf);

  const build = Bun.spawnSync([process.execPath, "scripts/build-foliate.ts"], {
    cwd: web,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) return build.exitCode ?? 1;

  const server = await createServer({
    root: web,
    configFile: resolve(web, "vite.config.ts"),
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 5191, strictPort: false, hmr: false },
    plugins: [corpusFiles(new Map(queue.map((book) => [book.id, book.path])))],
  });
  const chromes: HeadlessChrome[] = [];
  try {
    await server.listen();
    const origin = server.resolvedUrls?.local[0];
    if (!origin) throw new Error("The dev server did not report a local URL");
    let next = 0,
      finished = 0;
    const worker = async () => {
      let chrome = await launchHeadlessChrome(["--js-flags=--max-old-space-size=8192"]);
      chromes.push(chrome);
      for (let book = queue[next++]; book; book = queue[next++]) {
        await probeBook(chrome, origin, book, options);
        console.log(`[${++finished}/${queue.length}] ${book.relPath} — ${describe(book)}`);
        if (book.crashed || book.abandoned) {
          // A crashed or wedged renderer can take its siblings down; start clean.
          await chrome.close();
          chromes.splice(chromes.indexOf(chrome), 1);
          chrome = await launchHeadlessChrome(["--js-flags=--max-old-space-size=8192"]);
          chromes.push(chrome);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.jobs, queue.length) }, worker));
  } finally {
    await Promise.all(chromes.map((chrome) => chrome.close()));
    await server.close();
  }

  writeFileSync(join(options.out, "results.json"), JSON.stringify(books, null, 2));
  writeFileSync(
    join(options.out, "report.html"),
    renderCorpusReport(books, { root: options.dir, generatedAt: new Date().toISOString() }),
  );
  console.log(`\nReport: ${join(options.out, "report.html")}`);
  return 0;
}

process.exit(await main());
