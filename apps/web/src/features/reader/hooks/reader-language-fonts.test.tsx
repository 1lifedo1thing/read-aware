import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

if (process.env.READER_LANGUAGE_FONTS_CASE === "1") {
  test("implicit language fonts survive storage and respect book overrides and public settings", async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const globals = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const { useReaderAppearance } = await import("./useReaderAppearance");
    const { getReaderPreferences, DEFAULT_READER_PREFERENCES, READER_PREFERENCES_KEY } = await import("../../settings/lib/reader-settings");
    const { rememberReaderBookLanguage } = await import("../../settings/lib/reader-languages");
    const { readerPreferencesAtom, readerOverridesAtom } = await import("../../../state/ui");
    const { getDefaultStore } = await import("jotai");
    const { localKV } = await import("../../../platform/local-store");
    const { createSettingsDomain } = await import("../../../domain/settings/domain");
    const store = getDefaultStore();
    const appearances: Record<string, ReturnType<typeof useReaderAppearance>> = {};
    function Probe({ id }: { id: string }) { appearances[id] = useReaderAppearance(id); return null; }
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      store.set(readerPreferencesAtom, { ...DEFAULT_READER_PREFERENCES, fontFamily: "curated:literata" });
      store.set(readerOverridesAtom, {});
      for (const [id, language] of [["zh1", "zh-CN"], ["zh2", "zh-TW"], ["en", "en-US"], ["fr", "fr-CA"]]) {
        rememberReaderBookLanguage(id!, language!, "system");
      }
      await act(async () => { root.render(<>{["zh1", "zh2", "en", "fr", "unknown"].map(id => <Probe key={id} id={id} />)}</>); });
      const english = appearances.en!.effective;
      await act(async () => { appearances.zh1!.updatePrefs({ ...appearances.zh1!.prefs, fontFamily: "curated:lxgw", fontWeight: "bold" }); });
      expect(appearances.zh2!.effective).toMatchObject({ fontFamily: "curated:lxgw", fontWeight: "bold" });
      expect(appearances.en!.effective).toBe(english);
      expect(appearances.fr!.effective.fontFamily).toBe("curated:literata");
      expect(appearances.unknown!.effective.fontFamily).toBe("curated:literata");
      expect(appearances.zh1!.effective).not.toHaveProperty("languageFonts");

      await act(async () => { appearances.fr!.updatePrefs({ ...appearances.fr!.prefs, fontFamily: "system:Georgia" }); });
      await act(async () => { appearances.en!.updatePrefs({ ...appearances.en!.prefs, fontFamily: "curated:inter", fontSize: "large" }); });
      for (const appearance of Object.values(appearances)) expect(appearance.effective.fontSize).toBe("large");
      expect(appearances.zh2!.effective.fontFamily).toBe("curated:lxgw");
      expect(appearances.fr!.effective.fontFamily).toBe("system:Georgia");

      await act(async () => { appearances.zh1!.setScope("book"); });
      expect(appearances.zh1!.prefs.fontFamily).toBe("curated:lxgw");
      await act(async () => { appearances.zh1!.updatePrefs({ ...appearances.zh1!.prefs, fontFamily: "system:Songti SC" }); });
      expect(appearances.zh2!.effective.fontFamily).toBe("curated:lxgw");
      await act(async () => { appearances.zh1!.setScope("global"); });
      expect(appearances.zh1!.effective.fontFamily).toBe("curated:lxgw");
      await act(async () => { appearances.zh1!.setScope("book"); });
      expect(appearances.zh1!.effective.fontFamily).toBe("system:Songti SC");

      const domain = createSettingsDomain("agent");
      for (const [bookId, value] of [["zh1", "system:Songti SC"], ["zh2", "curated:lxgw"], ["en", "curated:inter"], ["fr", "system:Georgia"]]) {
        expect((await domain.queries.read("reading.fontFamily", { kind: "book", bookId: bookId! })).value).toBe(value!);
      }
      const persisted = localKV.getItem(READER_PREFERENCES_KEY)!;
      expect(getReaderPreferences().languageFonts).toMatchObject({ zh: { fontFamily: "curated:lxgw", fontWeight: "bold" }, en: { fontFamily: "curated:inter" }, fr: { fontFamily: "system:Georgia" } });
      await act(async () => { store.set(readerPreferencesAtom, DEFAULT_READER_PREFERENCES); });
      await act(async () => { localKV.setItem(READER_PREFERENCES_KEY, persisted); });
      expect(appearances.zh2!.effective.fontFamily).toBe("curated:lxgw");
      expect(appearances.fr!.effective.fontFamily).toBe("system:Georgia");

      // The public all-books operation must still mean all languages and overrides.
      await act(async () => { await domain.commands.update([{ path: "reading.fontFamily", value: "system:Arial", target: { kind: "all-books" } }]); });
      for (const appearance of Object.values(appearances)) expect(appearance.effective.fontFamily).toBe("system:Arial");
      await act(async () => { await domain.commands.resetReading({ action: "defaults", target: { kind: "all-books" } }); });
      expect(getReaderPreferences()).toEqual(DEFAULT_READER_PREFERENCES);
    } finally {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
  });
} else {
  test("isolated automatic per-language font preference contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, READER_LANGUAGE_FONTS_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
  }, 30_000);
}
