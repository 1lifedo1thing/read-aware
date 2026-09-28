/**
 * Headless Chrome over the DevTools protocol, shared by the scripts that drive the web
 * dev server in a real layout engine (`run-runtime-regressions.ts`, `run-corpus-probe.ts`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function chromeExecutable(): string {
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

type DevToolsEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

/** Minimal DevTools protocol client over the browser WebSocket endpoint. */
export class DevTools {
  #next = 0;
  #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  #listeners = new Set<(event: DevToolsEvent) => void>();
  #closed = false;
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      } & Partial<DevToolsEvent>;
      if (message.id === undefined) {
        if (message.method) for (const listener of this.#listeners) listener(message as DevToolsEvent);
        return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      this.#closed = true;
      for (const pending of this.#pending.values()) pending.reject(new Error("DevTools connection closed"));
      this.#pending.clear();
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
    if (this.#closed) return Promise.reject(new Error("DevTools connection closed"));
    const id = ++this.#next;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Protocol events (`Runtime.exceptionThrown`, …); returns the unsubscribe. */
  on(listener: (event: DevToolsEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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

export type HeadlessChrome = {
  devtools: DevTools;
  /** Open a fresh page target and attach a flattened session to it. */
  newPage(url?: string): Promise<{ targetId: string; sessionId: string }>;
  closePage(targetId: string): Promise<void>;
  close(): Promise<void>;
};

/** Launch Chrome headless in a throwaway profile. `close()` kills it and removes the profile. */
export async function launchHeadlessChrome(extraArgs: string[] = []): Promise<HeadlessChrome> {
  const profile = mkdtempSync(join(tmpdir(), "readaware-chrome-"));
  const chrome = Bun.spawn(
    [
      chromeExecutable(),
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      ...extraArgs,
      "about:blank",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  let devtools: DevTools;
  try {
    devtools = await DevTools.open(await browserEndpoint(chrome));
  } catch (error) {
    chrome.kill();
    await chrome.exited;
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
  return {
    devtools,
    async newPage(url = "about:blank") {
      const { targetId } = await devtools.send<{ targetId: string }>("Target.createTarget", { url });
      const { sessionId } = await devtools.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      return { targetId, sessionId };
    },
    async closePage(targetId) {
      await devtools.send("Target.closeTarget", { targetId });
    },
    async close() {
      devtools.close();
      chrome.kill();
      await chrome.exited;
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
