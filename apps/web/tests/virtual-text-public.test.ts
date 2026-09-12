import { expect, spyOn, test } from "bun:test";
import { withDom } from "./helpers/foliate-dom";
import { localKV, flushLocalKV } from "../src/platform/local-store";
import * as blobs from "../src/platform/blob-store";
import { bindVirtualBook } from "../src/features/plugins/lib/virtual-books";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";
import { getPersistedChapters } from "../src/domain/library";
import { createBookTextPort } from "../src/features/ai/agent/ports/book-text-port";
import { textDetail } from "../../../plugins/text-desk/src/views";

test("registered virtual content flows through public text tasks, Text Desk and Agent with invalidation and retirement fences", async () => withDom(async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const bookId = crypto.randomUUID(), registryKey = "read-aware-virtual-books";
  const bytes = new Map<string, Uint8Array>();
  const spies = [
    spyOn(blobs, "getDesktopBlob").mockImplementation(async key => bytes.get(key) ?? null),
    spyOn(blobs, "putDesktopBlob").mockImplementation(async (key, data) => { bytes.set(key, new Uint8Array(data)); return { sha256: "fixture", byteSize: data.length }; }),
    spyOn(blobs, "deleteDesktopBlob").mockImplementation(async key => { bytes.delete(key); }),
  ];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: { invoke: async (command: string) => {
    const row = { id: bookId, title: "Feed", format: "virtual", coverStatus: "none" };
    if (command === "library_get_book") return row;
    if (command === "library_load") return [row];
    if (command === "set_kv" || command === "delete_kv") return;
    throw Error(`Unexpected IPC: ${command}`);
  } } } });
  const savedRegistry = localKV.getItem(registryKey);
  const provider = buildPluginContext({ id: "virtual-index", name: "Feed", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:write"] }, "1", []);
  const consumer = buildPluginContext({ id: "virtual-index-consumer", name: "Text", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:write", "reading:write"] }, "1", []);
  let loads = 0, text = "First virtual chapter has enough prose to form a durable indexed chapter for the Agent.";
  try {
    provider.lifecycle.promote(); consumer.lifecycle.promote();
    provider.context.contributions.contentProviders.register({ id: "feed", load: async () => { loads++; return { sections: [{ id: "article", title: "Article", html: `<p>${text}</p>` }] }; } });
    bindVirtualBook(bookId, { pluginId: "virtual-index", providerId: "feed", key: "one" }); await flushLocalKV();
    const library = consumer.context.domains.library!, book = library.queries.books;
    expect(await book.getTextState(bookId)).toMatchObject({ status: "unprepared", contentVersion: null }); expect(loads).toBe(0);
    const detail = await textDetail(consumer.context, bookId, "Feed"); expect(detail.actions!.some(a => a.id === "prepare")).toBe(true);
    const task = await library.commands!.books.prepareText(bookId);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Text task did not settle")), 2000);
      library.events.observeTextTask(bookId, task.taskId, state => {
        if (state.status === "completed") { clearTimeout(timeout); resolve(); }
        if (state.status === "failed") { clearTimeout(timeout); reject(Error(state.errorCode)); }
      });
    });
    const indexed = await getPersistedChapters(bookId);
    expect(indexed![0]!.hrefs).toEqual(["article"]); expect(indexed![0]!.text).toContain(text);
    const agent = createBookTextPort(); expect((await agent.getToc(bookId))[0]!.title).toBe("Article");
    expect(await agent.getChapterText(bookId, 0)).toContain(text);
    const old = (await book.getTextState(bookId)).contentVersion;
    text = "Updated virtual article contains distinct new prose and must not reuse the old derived chapter.";
    await provider.context.domains.library!.commands!.books.invalidateVirtualBook({ providerId: "feed", key: "one" });
    expect(await getPersistedChapters(bookId)).toBeNull();
    expect((await book.getTextState(bookId)).status).toBe("unprepared");
    expect(await agent.getChapterText(bookId, 0)).toContain(text);
    expect((await book.getTextState(bookId)).contentVersion).not.toBe(old);
    provider.lifecycle.stop(); expect((await book.getTextState(bookId)).status).toBe("unavailable");
    await expect(agent.getChapterText(bookId, 0)).rejects.toMatchObject({ code: "library/content-unavailable" });
    expect(bytes.has(`booktext:${bookId}`)).toBe(true); // Unavailable does not destroy retained private data.
  } finally {
    provider.lifecycle.stop(); consumer.lifecycle.stop(); await Promise.all([provider.lifecycle.drainCleanups(), consumer.lifecycle.drainCleanups()]);
    if (savedRegistry === null) localKV.removeItem(registryKey); else localKV.setItem(registryKey, savedRegistry);
    await flushLocalKV(); for (const spy of spies) spy.mockRestore();
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
}));
