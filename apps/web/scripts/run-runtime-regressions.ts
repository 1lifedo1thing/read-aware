/**
 * Run the reader runtime regression suites (tests/runtime) in headless Chrome.
 *
 *   bun run test:runtime            # from apps/web
 *   CHROME_PATH=/path/to/chrome bun run test:runtime
 *
 * Starts the web dev server on a free port, opens tests/runtime/index.html in a fresh
 * headless Chrome profile through the DevTools protocol, waits for the harness to publish
 * `window.__runtimeRegressions`, prints every result and exits non-zero on any failure.
 *
 * Chrome (Blink) is the scriptable parity run. The shipping macOS/iOS engine is WebKit, so
 * layout-sensitive changes still need the foreground Tauri run described in harness.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { RuntimeReport } from "../tests/runtime/harness";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = Number(process.env.RUNTIME_REGRESSION_TIMEOUT_MS ?? 600_000);

function chromeExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    process.platform === "darwin" ? "/Applications/Chromium.app/Contents/MacOS/Chromium" : undefined,
    Bun.which("google-chrome-stable") ?? undefined,
    Bun.which("google-chrome") ?? undefined,
    Bun.which("chromium") ?? undefined,
    Bun.which("chromium-browser") ?? undefined,
    process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined,
  ];
  for (const candidate of candidates) if (candidate && Bun.file(candidate).size > 0) return candidate;
  throw new Error("Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.");
}

/** Minimal DevTools protocol client over the browser WebSocket endpoint. */
class DevTools {
  #next = 0;
  #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static open(url: string): Promise<DevTools> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new DevTools(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Cannot connect to ${url}`)), { once: true });
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.#next;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function browserEndpoint(chrome: Bun.Subprocess<"ignore", "ignore", "pipe">): Promise<string> {
  const decoder = new TextDecoder();
  const reader = chrome.stderr.getReader();
  let output = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    output += decoder.decode(chunk.value, { stream: true });
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
    if (!match) continue;
    // Keep draining Chrome's log so a full pipe can never stall the browser.
    // A read error only means Chrome went away, which the run reports through its own result.
    void (async () => {
      while (!(await reader.read()).done);
    })().catch(() => {});
    return match[1]!;
  }
  throw new Error(`Chrome exited before exposing DevTools:\n${output}`);
}

async function main(): Promise<number> {
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
    server: { host: "127.0.0.1", port: 5190, strictPort: false, hmr: false },
  });
  const profile = mkdtempSync(join(tmpdir(), "readaware-runtime-"));
  let chrome: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined;
  let devtools: DevTools | undefined;
  try {
    await server.listen();
    const origin = server.resolvedUrls?.local[0];
    if (!origin) throw new Error("The dev server did not report a local URL");
    chrome = Bun.spawn(
      [
        chromeExecutable(),
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,900",
        "about:blank",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
    );
    devtools = await DevTools.open(await browserEndpoint(chrome));
    const { targetId } = await devtools.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await devtools.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await devtools.send("Page.navigate", { url: new URL("tests/runtime/index.html", origin).href }, sessionId);

    const deadline = Date.now() + TIMEOUT_MS;
    let report: RuntimeReport | undefined;
    while (Date.now() < deadline) {
      const { result } = await devtools.send<{ result: { value?: string } }>(
        "Runtime.evaluate",
        {
          expression: "JSON.stringify(window.__runtimeRegressions ?? null)",
          returnByValue: true,
        },
        sessionId,
      );
      report = result.value ? ((JSON.parse(result.value) as RuntimeReport | null) ?? undefined) : undefined;
      if (report?.done) break;
      await Bun.sleep(500);
    }
    if (!report?.done) throw new Error(`Runtime regressions did not finish within ${TIMEOUT_MS} ms`);
    for (const result of report.results) {
      console.log(`${result.passed ? "pass" : "FAIL"}  [${result.suite}] ${result.name}`);
      if (!result.passed && result.details) console.log(`      ${result.details.replaceAll("\n", "\n      ")}`);
    }
    const failed = report.results.filter((result) => !result.passed).length;
    if (report.error) console.error(`Harness failed: ${report.error}`);
    console.log(`\n${report.results.length - failed} pass, ${failed} fail`);
    return failed === 0 && !report.error && report.results.length > 0 ? 0 : 1;
  } finally {
    devtools?.close();
    chrome?.kill();
    await chrome?.exited;
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

process.exit(await main());
