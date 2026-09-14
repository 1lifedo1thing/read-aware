import { expect, test } from "bun:test";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { actorCause, causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { HostWindowService, type WindowViewport } from "../../../services/window-controller";
import { hostWindow } from "../../../services/window";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";
import { DEFAULT_READER_SETTINGS } from "../../settings/lib/reader-settings";
import type { FoliateRenderer, FoliateView } from "../lib/foliate-engine";
import type { ReaderSelectionState } from "../lib/selection-overlay";
import { readingRenderActor } from "../lib/reading-render-context";
import { useReaderTypography } from "./useReaderTypography";
import { useReaderViewportResize } from "./useReaderViewportResize";

if (process.env.READER_VIEWPORT_CASE === "1") {
  test("event-bound window resize reaches selection and text measure, retiring stale DOM and view feedback", async () => {
    const dom = new JSDOM("<div id='root'></div><section id='viewport'></section>", { url: "http://localhost" });
    const chapter = new JSDOM("<p>First passage</p><p>Second passage</p>");
    const replacement = new JSDOM("<p>New chapter</p>");
    const observers: ResizeProbe[] = [];
    class ResizeProbe {
      active = false;
      constructor(readonly callback: () => void) { observers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    }
    const values = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
      ResizeObserver: ResizeProbe, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const root = createRoot(dom.window.document.getElementById("root")!);
    const viewportRef = { current: dom.window.document.getElementById("viewport")! };
    const dimensions = { width: 800, height: 600 };
    let width = 700, doc = chapter.window.document;
    Object.defineProperties(viewportRef.current, { clientWidth: { get: () => width }, clientHeight: { get: () => 500 } });
    Object.assign(dom.window, { innerWidth: dimensions.width, innerHeight: dimensions.height });
    const native = new HostWindowService({ supported: () => true,
      read: async () => ({ minimized: false, maximized: dimensions.width > 800, fullscreen: false, focused: true, viewport: { ...dimensions } }),
      apply: async () => { Object.assign(dimensions, { width: 1200, height: 900 }); }, watch: async () => () => {},
    }, error => { throw error; });
    const original = { layout: hostWindow.layout, control: hostWindow.control };
    hostWindow.layout = () => native.layout();
    hostWindow.control = (request, signal, origin) => native.control(request, signal, origin);
    const measures: { values: Record<string, string>; origin: DomainActor }[] = [], clears: object[] = [];
    const renderer = { getContents: () => [{ doc, index: 0 }],
      setLayoutAttributes: (values: Record<string, string>, context: object) => { measures.push({ values, origin: readingRenderActor(context) }); },
      setStyles() {}, setPageColors() {},
    } as unknown as FoliateRenderer;
    const viewRef = { current: { renderer } as unknown as FoliateView };
    const selectionRef = { current: null as ReaderSelectionState | null };
    const isFixedLayoutRef = { current: false }, readingModeRef = { current: "scroll" as const };
    const layoutForReadingMode = () => ({ maxColumnCount: 1 });
    const clearSelection = (origin: DomainActor) => { clears.push(stampEventCause({}, origin)); doc.getSelection()!.removeAllRanges(); selectionRef.current = null; };
    function Harness() {
      const typography = useReaderTypography({ readerSettings: DEFAULT_READER_SETTINGS, viewRef, readerRootRef: viewportRef,
        viewportRef, isFixedLayoutRef, readingModeRef, layoutForReadingMode });
      useReaderViewportResize({ viewportRef, viewRef, selectionRef, clearSelection, applyMaxInlineSize: typography.applyMaxInlineSize });
      return null;
    }
    const runtime = buildPluginContext({ id: "viewport", name: "Viewport", version: "1", schemaVersion: 1, requires: {} }, "1", []);
    runtime.lifecycle.promote();
    const rule = {};
    const select = (index: number) => {
      const text = doc.querySelectorAll("p")[index]!.firstChild!;
      const range = doc.createRange(); range.setStart(text, 0); range.setEnd(text, 5);
      doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    };
    const resize = (w: number) => { width = w - 100; Object.assign(dom.window, { innerWidth: w, innerHeight: 900 }); observers.find(item => item.active)!.callback(); };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const flush = (run: () => void = () => {}) => act(async () => { run(); await tick(); });
    try {
      await flush(() => root.render(<StrictMode><Harness /></StrictMode>));
      expect(observers.filter(item => item.active)).toHaveLength(1);
      const initial = measures.length;
      await flush(() => observers.find(item => item.active)!.callback());
      expect(measures).toHaveLength(initial); expect(clears).toHaveLength(0);
      select(0);
      await runtime.reactions.deliver(rule, stampEventCause({}, causalActor("user")), async reaction => {
        const actor = runtime.reactions.actor(reaction);
        await runtime.context.withEvent({ reaction }).services.ui.window!.control({ action: "maximize" });
        await flush(() => resize(1200));
        expect(doc.getSelection()!.rangeCount).toBe(0);
        expect(actorCause(measures.at(-1)!.origin)).toBe(actorCause(actor));
        expect(measures.at(-1)!.values["max-inline-size"]).toMatch(/px$/);
        await runtime.reactions.deliver(rule, clears.at(-1)!, next => { expect(next.status).toBe("cycle"); });
      });
      const oldRoot = actorCause(measures.at(-1)!.origin)!.root;
      dimensions.width = 1150; select(0);
      await flush(() => resize(1150));
      expect(actorCause(measures.at(-1)!.origin)!.root).not.toBe(oldRoot);
      await runtime.reactions.deliver(rule, clears.at(-1)!, next => { expect(next.status).toBe("ready"); });

      const hold = () => {
        const pending = Promise.withResolvers<WindowViewport | null>(); hostWindow.layout = () => pending.promise; return pending;
      };
      const source = causalActor("plugin:window");
      select(0); let count = clears.length;
      const changedSelection = hold(); await flush(() => resize(1100)); select(1);
      await flush(() => changedSelection.resolve(stampEventCause({ width: 1100, height: 900 }, source)));
      expect(clears).toHaveLength(count); expect(doc.getSelection()!.toString()).toBe("Secon");
      expect(actorCause(measures.at(-1)!.origin)).toBe(actorCause(source));

      const newInput = hold(); await flush(() => resize(1050));
      doc.dispatchEvent(new chapter.window.Event("pointerdown")); // same selection, new intent before selectionchange settles
      await flush(() => newInput.resolve(stampEventCause({ width: 1050, height: 900 }, source)));
      expect(clears).toHaveLength(count);

      const newChapter = hold(); await flush(() => resize(1000)); doc = replacement.window.document; select(0);
      await flush(() => newChapter.resolve(stampEventCause({ width: 1000, height: 900 }, source)));
      expect(clears).toHaveLength(count); expect(doc.getSelection()!.toString()).toBe("New c");

      const first = hold(); await flush(() => resize(950));
      const second = hold(); await flush(() => resize(900));
      await flush(() => second.resolve(stampEventCause({ width: 900, height: 900 }, source)));
      count = measures.length;
      await flush(() => first.resolve(stampEventCause({ width: 950, height: 900 }, source)));
      expect(measures).toHaveLength(count);
      const retiredView = hold(); await flush(() => resize(850)); viewRef.current = { renderer } as unknown as FoliateView;
      await flush(() => retiredView.resolve(stampEventCause({ width: 850, height: 900 }, source)));
      expect(measures).toHaveLength(count);

      const failed = hold(); await flush(() => resize(800));
      await flush(() => failed.reject(new Error("controlled geometry failure")));
      expect(measures).toHaveLength(count + 1); expect(actorCause(measures.at(-1)!.origin)).not.toBe(actorCause(source));
      const stopped = hold(); await flush(() => resize(750));
      await flush(() => root.unmount()); count = measures.length;
      await flush(() => stopped.resolve(stampEventCause({ width: 750, height: 900 }, source)));
      expect(measures).toHaveLength(count); expect(observers.every(item => !item.active)).toBe(true);
    } finally {
      await flush(() => root.unmount()); runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups();
      hostWindow.layout = original.layout; hostWindow.control = original.control;
      dom.window.close(); chapter.window.close(); replacement.window.close();
      for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
    }
  });
} else {
  test("isolated reader viewport resize contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, READER_VIEWPORT_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
