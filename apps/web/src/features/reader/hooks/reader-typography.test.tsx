import { expect, mock, test } from "bun:test";
import { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { ReaderSettings } from "../../settings/lib/reader-settings";
import type { FoliateRenderer, FoliateView } from "../lib/foliate-engine";
import { actorCause, causalActor, eventCause, stampEventCause } from "../../../platform/domain-actor";
import { readingRenderActor } from "../lib/reading-render-context";

if (process.env.READER_TYPOGRAPHY_CASE === "1") {
  const waiting = new Map<string, Promise<string>>();
  mock.module("../../settings/lib/curated-font-loader", () => ({ ensureCuratedFontFaceCss: (id: string) => waiting.get(id) ?? Promise.resolve("") }));
  const { useReaderTypography } = await import("./useReaderTypography");
  const { useReaderAppearance } = await import("./useReaderAppearance");
  const { useReaderEngineLoadSource } = await import("./useReaderEngineLoadSource");
  const { readingRuntime } = await import("../../../domain/reading-runtime");
  const { attachReadingEngine } = await import("../lib/reading-engine-adapter");
  const { useAppearance } = await import("../../settings/hooks/useAppearance");
  const { DEFAULT_READER_PREFERENCES, READER_PREFERENCES_KEY } = await import("../../settings/lib/reader-settings");
  const { READER_OVERRIDES_KEY } = await import("../../settings/lib/reader-overrides");
  const { APP_SETTINGS_KEY } = await import("../../settings/lib/app-settings");
  const { localKV, flushLocalKV } = await import("../../../platform/local-store");
  const { buildPluginContext } = await import("../../plugins/runtime/plugin-context");
  const { getDefaultStore } = await import("jotai");
  const { appSettingsAtom } = await import("../../../state/ui");
  const { emitAppEvent } = await import("../../../platform/app-events");
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  test("public settings reactions reach CSS and layout through native KV and the committed appearance projection", async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    let heldWrite: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    Object.assign(dom.window, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      __TAURI_INTERNALS__: { invoke(command: string) {
        if (command === "local_device_get") return Promise.resolve({ deviceId: "typography", lastHlcWallMs: null, lastHlcCounter: null });
        if (command === "desktop_startup_enabled") return Promise.resolve(false);
        if (command === "set_kv_batch" && heldWrite) return heldWrite.promise;
        return Promise.resolve();
      } } });
    const root = createRoot(dom.window.document.getElementById("root")!);
    const rendered: { css: string; context: object }[] = [], layouts: object[] = [];
    const renderer = { setStyles(css: string, context: object) { rendered.push({ css, context }); },
      setLayoutAttributes(_values: object, context: object) { layouts.push(context); } } as unknown as FoliateRenderer;
    const events = new EventTarget();
    const viewRef = { current: { renderer, lastLocation: { cfi: "current", fraction: 0.5, section: { current: 0, total: 1 } },
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    } as unknown as FoliateView }, viewportRef = { current: dom.window.document.body };
    const loadedBook = { fileName: "book.epub", format: "epub" as const };
    const sessionId = readingRuntime.begin("book", undefined, causalActor("user"));
    let engineSource!: ReturnType<typeof useReaderEngineLoadSource>;
    const retirements: object[] = [];
    let appearance!: ReturnType<typeof useReaderAppearance>, typography!: ReturnType<typeof useReaderTypography>;
    const layoutForReadingMode = () => ({ maxColumnCount: 1 });
    const isFixedLayoutRef = { current: false }, readingModeRef = { current: "scroll" as const };
    function Harness() {
      useAppearance(); appearance = useReaderAppearance("book");
      engineSource = useReaderEngineLoadSource(loadedBook, "book", appearance.effective.readingMode, appearance.effective);
      useEffect(() => {
        const detach = attachReadingEngine(viewRef.current, sessionId, "book", "version", "version", engineSource.current!.origin);
        return () => { retirements.push(stampEventCause({}, engineSource.current!.origin)); detach(engineSource.current!.origin); };
      }, [appearance.effective.readingMode]);
      typography = useReaderTypography({ readerSettings: appearance.effective, viewRef, readerRootRef: viewportRef, viewportRef,
        isFixedLayoutRef, readingModeRef, layoutForReadingMode });
      return null;
    }
    const runtime = buildPluginContext({ id: "typography", name: "Typography", version: "1", schemaVersion: 1, requires: {},
      settingsAccess: { read: ["reading.*", "appearance.*"], write: ["reading.*", "appearance.*"] } }, "1", []);
    runtime.lifecycle.promote();
    try {
      await localKV.setItemAsync(READER_PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_READER_PREFERENCES, fontFamily: "system:Arial", theme: "auto" }));
      await localKV.setItemAsync(READER_OVERRIDES_KEY, "{}");
      await localKV.setItemAsync(APP_SETTINGS_KEY, JSON.stringify({ theme: "light", motion: "system" }));
      await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); await tick(); });
      expect(eventCause(readingRuntime.snapshot())?.root).toBe(actorCause(readingRuntime.openingActor(sessionId))?.root);
      const originalLoad = engineSource.current;
      for (const target of [{ kind: "global" }, { kind: "book", bookId: "book" }] as const) {
        await runtime.reactions.deliver({}, stampEventCause({}, causalActor("user")), async reaction => {
          const bound = runtime.context.withEvent({ reaction }), origin = runtime.reactions.actor(reaction);
          await act(async () => { await bound.domains.settings.commands.update([{ path: "reading.fontSize", value: target.kind === "global" ? "large" : "x-large", target }]); await tick(); });
          expect(eventCause(appearance.effective)?.root).toBe(actorCause(origin)!.root);
          expect(actorCause(readingRenderActor(rendered.at(-1)!.context))?.steps).toEqual(actorCause(origin)!.steps);
          expect(actorCause(readingRenderActor(layouts.at(-1)!))?.root).toBe(actorCause(origin)!.root);
        });
      }
      // An unrelated book's stored override cannot repaint this reader or
      // smuggle another root into its next automatic response.
      const current = appearance.effective, count = rendered.length;
      await act(async () => { await runtime.context.domains.settings.commands.update([{ path: "reading.fontSize", value: "xx-large", target: { kind: "book", bookId: "other" } }]); await tick(); });
      expect(appearance.effective).toBe(current); expect(rendered.length).toBe(count);
      await act(async () => { appearance.setScope("global"); await flushLocalKV(); await tick(); });
      expect(appearance.effective.fontSize).toBe("large"); expect(eventCause(appearance.effective)?.steps).toEqual([]);
      await runtime.reactions.deliver({}, stampEventCause({}, causalActor("user")), async reaction => {
        const origin = runtime.reactions.actor(reaction);
        await act(async () => { await runtime.context.withEvent({ reaction }).domains.settings.commands.update([{ path: "appearance.theme", value: "dark" }]); await tick(); });
        expect(appearance.effective.theme).toBe("dark");
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))?.root).toBe(actorCause(origin)!.root);
      });
      const currentAppSettings = getDefaultStore().get(appSettingsAtom);
      await act(async () => { emitAppEvent("roaming-preferences-changed", { keys: [APP_SETTINGS_KEY] }); await tick(); });
      expect(getDefaultStore().get(appSettingsAtom)).toBe(currentAppSettings);
      expect(engineSource.current).toBe(originalLoad);
      // A real public settings reaction rebuilds this same session, preserving
      // its cause through outgoing cleanup and the adapter's ready/relocate.
      const rule = {};
      await runtime.reactions.deliver(rule, stampEventCause({}, causalActor("user")), async reaction => {
        const actor = runtime.reactions.actor(reaction);
        const next = appearance.effective.readingMode === "scroll" ? "paginated-single" : "scroll";
        await act(async () => { await runtime.context.withEvent({ reaction }).domains.settings.commands.update([
          { path: "reading.readingMode", value: next, target: { kind: "global" } },
        ]); await tick(); });
        expect(eventCause(retirements.at(-1)!)?.root).toBe(actorCause(actor)?.root);
        expect(eventCause(readingRuntime.snapshot())?.steps).toEqual(actorCause(actor)?.steps);
        expect(eventCause(readingRuntime.snapshot())?.root).toBe(actorCause(actor)?.root);
        expect(readingRuntime.snapshot().status).toBe("ready");
        expect(readingRuntime.snapshot().sessionId).toBe(sessionId);
      });
      await runtime.reactions.deliver(rule, readingRuntime.snapshot(), reaction => {
        expect(reaction.status).toBe("cycle");
        expect(() => runtime.reactions.actor(reaction)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
      });
      const reactedRoot = eventCause(readingRuntime.snapshot())!.root;
      await act(async () => { appearance.updatePrefs({ ...appearance.prefs,
        readingMode: appearance.effective.readingMode === "scroll" ? "paginated-single" : "scroll" }); await flushLocalKV(); await tick(); });
      expect(eventCause(readingRuntime.snapshot())?.root).not.toBe(reactedRoot);
      await runtime.reactions.deliver(rule, readingRuntime.snapshot(), reaction => { expect(reaction.status).not.toBe("cycle"); });
      await runtime.reactions.deliver({}, stampEventCause({}, causalActor("user")), async reaction => {
        const origin = runtime.reactions.actor(reaction), previousSize = appearance.effective.fontSize;
        heldWrite = Promise.withResolvers<void>();
        let failed!: Promise<unknown>;
        await act(async () => { failed = runtime.context.withEvent({ reaction }).domains.settings.commands.update([
          { path: "reading.fontSize", value: "xxx-large", target: { kind: "global" } },
        ]).catch(error => error); await tick(); });
        expect(appearance.effective.fontSize).toBe("xxx-large");
        await act(async () => { heldWrite!.reject({ code: "db/locked", message: "Controlled write failure" });
          expect(await failed).toMatchObject({ code: "db/locked" }); heldWrite = undefined; await tick(); });
        expect(appearance.effective.fontSize).toBe(previousSize);
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))?.root).toBe(actorCause(origin)!.root);
      });
      const slow = Promise.withResolvers<string>(), source = causalActor("plugin:slow-font");
      waiting.set("inter", slow.promise);
      const oldSettings = stampEventCause({ ...appearance.effective, fontFamily: "curated:inter" } as ReaderSettings, source);
      const old = typography.injectStyles(oldSettings);
      const latest = causalActor("user");
      await typography.injectStyles(stampEventCause({ ...appearance.effective, fontFamily: "system:Georgia" }, latest));
      const accepted = rendered.at(-1), before = rendered.length;
      slow.resolve("/* obsolete font */"); await old;
      expect(rendered.length).toBe(before); expect(rendered.at(-1)).toBe(accepted);
      expect(actorCause(readingRenderActor(accepted!.context))?.root).toBe(actorCause(latest)!.root);
      const retired = Promise.withResolvers<string>(); waiting.set("inter", retired.promise);
      const pending = typography.injectStyles(oldSettings);
      viewRef.current = { renderer: { setStyles() { throw Error("Old styles reached replacement renderer"); } } } as unknown as FoliateView;
      retired.resolve("/* replaced reader */"); await pending;
      expect(rendered.length).toBe(before);
      viewRef.current = { renderer } as FoliateView;
      const unmounted = Promise.withResolvers<string>(); waiting.set("inter", unmounted.promise);
      const unmountedRequest = typography.injectStyles(oldSettings);
      await act(async () => root.unmount()); unmounted.resolve("/* retired */"); await unmountedRequest;
      expect(rendered.length).toBe(before);
    } finally {
      heldWrite?.resolve();
      await act(async () => root.unmount()); runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups();
      readingRuntime.closed();
      waiting.clear(); dom.window.close();
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
  });
} else {
  test("isolated reader appearance and asynchronous typography contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, READER_TYPOGRAPHY_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
