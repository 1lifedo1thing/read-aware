import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@read-aware/core";
import { WEB_PROVIDERS, type WebClient } from "@read-aware/agent";
import { ToastProvider } from "@read-aware/ui";
import { initI18n } from "../../../i18n";
import { hydrateSecrets } from "../../../platform/secret-store";
import { getSearchConfig, saveSearchConfig } from "../../ai/lib/search-config";
import { useSearchConfig } from "./useSearchConfig";

if (process.env.SEARCH_SETTINGS_TEST === "1") {
  test("settings persist edits, test both APIs, reject failures, and discard stale connection results", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    await hydrateSecrets(); await initI18n("en");
    saveSearchConfig({ provider: "tinyfish", enabled: true, apiKey: "fixture-key" });
    const calls: string[] = [];
    const client: WebClient = {
      search: async input => { calls.push("search"); return { provider: "fixture", query: input.query, sources: [], retrievedAt: "2026-09-19" }; },
      fetch: async input => { calls.push("fetch"); return { provider: "fixture", url: input.url, finalUrl: input.url, title: "Example", text: "Example Domain", offset: 0, nextOffset: null, retrievedAt: "2026-09-19" }; },
    };
    const factory = spyOn(WEB_PROVIDERS.tinyfish, "create").mockReturnValue(client);
    let state!: ReturnType<typeof useSearchConfig>;
    function Harness() { state = useSearchConfig(); return null; }
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      await act(async () => { root.render(<StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>); });
      await act(async () => { state.change({ apiKey: "edited-key" }); });
      await act(async () => { state.flush(); });
      expect(getSearchConfig().apiKey).toBe("edited-key");
      await act(async () => { await state.test(); });
      expect(calls).toEqual(["search", "fetch"]); expect(state.result?.success).toBe(true);

      client.fetch = async () => { throw new AppError("search/fetch-failed", "RAW_PRIVATE_ERROR"); };
      await act(async () => { await state.test(); });
      expect(state.result?.success).toBe(false);
      expect(state.result?.message).not.toContain("RAW_PRIVATE_ERROR");
      expect(dom.window.document.body.textContent).toContain("This page could not be read");

      const gate = Promise.withResolvers<Awaited<ReturnType<WebClient["search"]>>>();
      let signal: AbortSignal | undefined;
      client.search = async (_input, incoming) => { signal = incoming; return gate.promise; };
      let pending!: Promise<void>;
      await act(async () => { pending = state.test(); await Bun.sleep(0); });
      await act(async () => { state.change({ apiKey: "new-key" }); });
      expect(signal?.aborted).toBe(true);
      await act(async () => { gate.resolve({ provider: "fixture", query: "old", sources: [], retrievedAt: "2026-09-19" }); await pending; });
      expect(state.result).toBeNull(); expect(state.testing).toBe(false);
      const brave = spyOn(WEB_PROVIDERS.brave, "create").mockImplementation(apiKey => {
        expect(apiKey).toBe("brave-key");
        return {
          search: async input => { calls.push("brave.search"); return { provider: "brave", query: input.query, sources: [], retrievedAt: "now" }; },
          fetch: async input => { calls.push("brave.fetch"); expect(input.url).toBe(WEB_PROVIDERS.brave.connectionTestUrl!);
            return { provider: "brave", url: input.url, finalUrl: input.url, title: "Source", text: "Extracted chunks", offset: 0, nextOffset: null, retrievedAt: "now" }; },
        };
      });
      const serp = spyOn(WEB_PROVIDERS.serpapi, "create").mockReturnValue({ search: async input => ({ provider: "serpapi", query: input.query, sources: [], retrievedAt: "now" }) });
      try {
        await act(async () => { state.changeProvider("brave"); });
        expect(state.config.apiKey).toBe("");
        await act(async () => { state.change({ apiKey: "brave-key" }); });
        calls.length = 0;
        await act(async () => { await state.test(); });
        expect(calls).toEqual(["brave.search", "brave.fetch"]);
        expect(state.result?.success).toBe(true); expect(state.result?.message).toContain("Search and Fetch");
        await act(async () => { state.changeProvider("serpapi"); });
        await act(async () => { state.change({ apiKey: "serp-key" }); });
        calls.length = 0;
        await act(async () => { await state.test(); });
        expect(calls).toEqual([]); // No TinyFish or Brave fetch fallback.
        expect(state.result?.success).toBe(true); expect(state.result?.message).toContain("does not support page reading");
        await act(async () => { state.changeProvider("brave"); });
        expect(state.config.apiKey).toBe("brave-key");
        await act(async () => { state.changeProvider("tinyfish"); });
        expect(state.config.apiKey).toBe("new-key");
      } finally { brave.mockRestore(); serp.mockRestore(); }
      await act(async () => { root.unmount(); });
      expect(getSearchConfig().apiKey).toBe("new-key");
    } finally { factory.mockRestore(); dom.window.close(); }
  });
} else {
  test("isolated search settings lifecycle", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SEARCH_SETTINGS_TEST: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
  });
}
