import { expect, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { bookUpdates } from "./book-updates";

test("failed current-state reads retain the durable position; reopening and expiration recover", async () => {
  let saved: any = null, fail = false, expired = false, opened = 0;
  const order: string[] = [];
  const ctx = {
    locale: "en", grants: { book: { mode: "all" } },
    services: {
      storage: { getDurable: async () => structuredClone(saved), set: async (_key: string, value: unknown) => { order.push("save"); saved = structuredClone(value); } },
      changes: { open: async () => { order.push("open"); return { cursor: String(++opened).repeat(48) }; },
        read: async (_query: unknown, cursor: string) => {
          expect(cursor).toBe(saved.cursor);
          if (expired) throw { code: "changes/cursor-expired" };
          return { cursor: "a".repeat(48), hasMore: true, changes: [{ areas: ["library"], bookId: "changed" }] };
        } },
    },
    domains: { library: { queries: { books: {
      list: async () => { order.push("baseline"); return [{ id: "original" }]; },
      get: async (id: string) => { if (fail) throw Error("read failed"); order.push("hydrate"); return { id, title: id, format: "epub" }; },
    } } } },
  } as unknown as PluginContext;
  const detail = async () => ({ kind: "detail" as const, title: "book", content: [] });
  await bookUpdates(ctx, detail);
  expect(order).toEqual(["open", "baseline", "hydrate", "save"]);
  fail = true;
  await expect(bookUpdates(ctx, detail, true)).rejects.toThrow("read failed");
  expect(saved.cursor).toBe("1".repeat(48));
  fail = false;
  await bookUpdates(ctx, detail, true);
  expect(saved.cursor).toBe("a".repeat(48));
  expect(saved.ids).toEqual(["changed"]);
  const reopened = await bookUpdates(ctx, detail);
  expect(reopened.items.some(item => item.title === "changed")).toBe(true);
  expired = true;
  await bookUpdates(ctx, detail, true);
  expect(saved.cursor).toBe("2".repeat(48));
  expect(saved.reset).toBe(true);
  expect(saved.ids).toEqual(["original"]);
});
