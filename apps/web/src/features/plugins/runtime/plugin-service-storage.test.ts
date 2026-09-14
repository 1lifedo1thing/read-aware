import { expect, test } from "bun:test";
import type { PluginDocument, PluginStorage } from "@read-aware/plugin-types";
import { bookServiceStorage } from "./plugin-service-storage";

test("book services fence provider documents, observers and CAS mutations; unscoped data stays inaccessible", async () => {
  const own: PluginDocument = { id: "own", bookId: "book", data: {}, revision: "old", updatedAt: "now" };
  const foreign = { ...own, id: "foreign", bookId: "foreign" };
  const filters: unknown[] = [], writes: unknown[] = [], deliveries: unknown[] = [];
  let conflict = false, observe: ((event: unknown) => unknown) | undefined;
  const raw = { collection: () => ({ get: async (id: string) => id === "own" ? own : id === "foreign" ? foreign : null,
    list: async (query: unknown) => { filters.push(query); return [own]; },
    page: async (query: unknown) => { filters.push(query); return { status: "ready", items: [own], nextCursor: null }; },
  }), applyDocuments: async (changes: unknown) => { writes.push(changes); return conflict ? { status: "conflict", index: 0 } : { status: "applied", documents: [] }; },
    observeDocuments: (_query: unknown, handler: (event: unknown) => unknown) => { observe = handler; return { dispose() {} }; },
  } as unknown as PluginStorage;
  const scoped = bookServiceStorage(raw, "book"), collection = scoped.collection("bookmarks");
  await collection.list(); await collection.page({ limit: 20, cursor: "cursor" });
  expect(filters).toEqual([{ bookId: "book" }, { bookId: "book", limit: 20, cursor: "cursor" }]);
  await expect(collection.get("foreign")).rejects.toMatchObject({ code: "plugin/service-forbidden" });
  await expect(collection.page({ bookId: "foreign" })).rejects.toThrow();
  await expect(collection.put("foreign", {}, { bookId: "book" })).rejects.toThrow();
  await expect(collection.delete("foreign")).rejects.toThrow();
  expect(writes).toHaveLength(0);
  await collection.put("own", { edited: true });
  expect(writes[0]).toEqual([{ kind: "put", collection: "bookmarks", id: "own", data: { edited: true }, bookId: "book", expectedRevision: "old" }]);
  conflict = true; await expect(collection.delete("own")).rejects.toMatchObject({ code: "plugin/service-data-changed" });
  await expect(scoped.applyDocuments([{ kind: "put", collection: "bookmarks", id: "new", expectedRevision: null, data: {} }])).rejects.toThrow();
  scoped.observeDocuments({ kind: "get", collection: "bookmarks", id: "foreign" }, event => deliveries.push(event));
  expect(() => observe!({ status: "ready", sequence: 1, result: { kind: "get", document: foreign } })).toThrow();
  expect(deliveries).toHaveLength(0);
  for (const action of [() => scoped.get("key"), () => scoped.getDurable("key"), () => scoped.set("key", "value"), () => scoped.policy()]) expect(action).toThrow();
});
