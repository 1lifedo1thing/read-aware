import { expect, test } from "bun:test";
import type { PluginContext, PluginModule, PluginDetailView, PluginListView, PluginViewResult } from "@read-aware/plugin-types";
import { jumperBookmarks } from "./bookmark-services";

test("compiled Text Desk consumes the compiled Jumper export, keeps its generation and refreshes expired pages explicitly", async () => {
  const jumper = (await import(new URL("../../jumper/dist/main.js", import.meta.url).href)).default as PluginModule;
  const textDesk = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  const manifest = await Bun.file(new URL("../../jumper/manifest.json", import.meta.url)).json();
  const ref = { pluginId: "jumper", id: "bookmark-page", version: "1.0.0", generation: "generation-1" };
  const requests: unknown[] = [], pages: unknown[] = [], commands = new Map<string, () => Promise<PluginViewResult>>();
  let changed = false;
  const provider = { grants: { book: { mode: "book", bookId: "book" } }, services: { storage: { collection: (name: string) => {
    expect(name).toBe("bookmarks");
    return { page: async (filter: { cursor?: string; bookId: string }) => {
      pages.push(filter);
      if (filter.cursor) return { status: "stale-cursor" };
      const data = { version: 1, name: "Saved passage", bookTitle: "Book", kind: "location", target: { bookId: "book", contentVersion: "version", href: "chapter.xhtml" } };
      return { status: "ready", items: [{ id: "own", data }, { id: "misindexed", data: { ...data, target: { ...data.target, bookId: "foreign" } } }], nextCursor: "cursor" };
    } };
  } } } } as unknown as PluginContext;
  const ctx = { locale: "en", domains: {
    library: { commands: {}, queries: { books: { list: async () => [{ id: "book", title: "Book", format: "epub" }], getTextState: async () => ({ status: "unprepared", text: "unknown", chapterCount: 0 }) } } },
    reading: { commands: {}, queries: { session: async () => ({}) } },
  }, services: { plugins: {
    listServices: async () => ({ services: [{ ...manifest.services[0], ref }], total: 1, nextOffset: null }),
    callService: async (request: { service: typeof ref; bookId: string; input: unknown }) => {
      requests.push(request);
      if (changed) throw Object.assign(Error("changed"), { code: "plugin/service-unavailable" });
      return { callId: "call", service: request.service, value: await jumper.services!["bookmark-page"]!(provider, request.input) };
    },
  } }, contributions: { commands: { register: (command: { id: string; run: () => Promise<PluginViewResult> }) => commands.set(command.id, command.run) }, headerActions: { register() {} }, selectionActions: { register() {} } },
  } as unknown as PluginContext;
  await textDesk.activate(ctx);
  const shelf = (await commands.get("open")!())!.view as PluginListView;
  const detail = (await shelf.items[0]!.onSelect!())!.view as PluginDetailView;
  const bookmarks = (await detail.actions!.find(action => action.id === "jumper-bookmarks")!.run())!.view as PluginListView;
  expect(bookmarks.items.map(item => item.title)).toEqual(["Saved passage"]);
  expect(pages).toEqual([{ bookId: "book", limit: 20 }]);
  const expired = (await bookmarks.actions!.find(action => action.id === "next")!.run())!.view as PluginDetailView;
  expect(expired.actions!.map(action => action.id)).toEqual(["refresh"]);
  expect(requests[1]).toEqual({ service: ref, bookId: "book", input: { limit: 20, cursor: "cursor" } });
  changed = true;
  const replaced = (await expired.actions![0]!.run())!.view as PluginDetailView;
  expect(replaced.actions!.map(action => action.id)).toEqual(["refresh"]);
  expect(requests).toHaveLength(3);
  for (const locale of ["zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    expect(JSON.stringify(await jumperBookmarks({ ...ctx, locale }, "book", "Book"))).not.toContain("undefined");
  }
});

test("missing Jumper is explained without calling a service; unexpected output fails visibly", async () => {
  const ctx = { locale: "en", services: { plugins: { listServices: async () => ({ services: [] }), callService: async () => { throw Error("must not call"); } } } } as unknown as PluginContext;
  const unavailable = await jumperBookmarks(ctx, "book", "Book") as PluginDetailView;
  expect(JSON.stringify(unavailable.content)).toContain("Enable Jumper");
  ctx.services.plugins.callService = async () => ({ callId: "call", service: { pluginId: "jumper", id: "bookmark-page", version: "1.0.0", generation: "g" }, value: { status: "ready", items: [{ name: 42 }], nextCursor: null } });
  await expect(jumperBookmarks(ctx, "book", "Book", { pluginId: "jumper", id: "bookmark-page", version: "1.0.0", generation: "g" })).rejects.toMatchObject({ code: "plugin/service-result-invalid" });
});
