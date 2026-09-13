import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { localKV } from "../../../platform/local-store";
import { aiPreferencesAtom } from "../../../state/ui";
import { useTranscriptAutoScroll } from "./useTranscriptAutoScroll";

if (process.env.TRANSCRIPT_SCROLL_CASE === "1") {
  test("late transcript layout follows only while streaming and the reader remains engaged", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    let resize: (() => void) | undefined;
    let disconnected = 0;
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: class {
        constructor(callback: () => void) { resize = callback; }
        observe() {}
        disconnect() { disconnected++; resize = undefined; }
      } };
    const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const store = getDefaultStore(), original = store.get(aiPreferencesAtom);
    const write = spyOn(localKV, "setItem").mockImplementation(() => {});
    let streaming = true, height = 600;
    const scrolls: number[] = [];
    dom.window.HTMLElement.prototype.scrollTo = ((options: ScrollToOptions) => { scrolls.push(options.top ?? 0); }) as typeof HTMLElement.prototype.scrollTo;
    function Harness() {
      const policy = useTranscriptAutoScroll({ messages: [], streamingParts: [], isStreaming: streaming, isLoading: false });
      return <div id="scroller" ref={policy.containerRef}><div ref={policy.contentRef}>Delayed markdown layout</div></div>;
    }
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      await act(async () => { store.set(aiPreferencesAtom, { ...original, followStreaming: true }); root.render(<Harness />); });
      const scroller = dom.window.document.getElementById("scroller")!;
      Object.defineProperties(scroller, { clientHeight: { get: () => 300 }, scrollHeight: { get: () => height } });
      const scroll = (top: number) => { scroller.scrollTop = top; scroller.dispatchEvent(new dom.window.Event("scroll")); };
      scroll(300); scrolls.length = 0;
      // No new parent render: Markdown/image layout arrives after the token effect.
      height = 900; resize!(); expect(scrolls).toEqual([900]);
      scroll(200); scrolls.length = 0;
      height = 1200; resize!(); expect(scrolls).toEqual([]);
      scroll(900); height = 1500; resize!(); expect(scrolls).toEqual([1500]);
      await act(async () => { streaming = false; root.render(<Harness />); });
      expect(resize).toBeUndefined(); expect(disconnected).toBe(1);
      await act(async () => { streaming = true; store.set(aiPreferencesAtom, { ...original, followStreaming: false }); root.render(<Harness />); });
      expect(resize).toBeUndefined();
      await act(async () => { store.set(aiPreferencesAtom, { ...original, followStreaming: true }); });
      expect(resize).toBeDefined();
    } finally {
      await act(async () => { root.unmount(); store.set(aiPreferencesAtom, original); });
      write.mockRestore(); dom.window.close();
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
    expect(disconnected).toBe(2);
  });
} else {
  test("isolated transcript scroll regression", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, TRANSCRIPT_SCROLL_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
