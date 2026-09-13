import { expect, test } from "bun:test";
import type { BookRangeQuery, PluginContext, PluginDetailView, PluginListView, PluginView, PluginViewUpdate } from "@read-aware/plugin-types";
import { capturedRangeDetail, rangeDetail, rangeResults, rangeSearchForm } from "./range-views";

function fixture() {
  const range = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)" };
  const reads: BookRangeQuery[] = [], jumps: unknown[] = [], searches: unknown[] = [], updates: PluginViewUpdate[] = [];
  const ctx = { locale: "en", services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => {
    updates.push(update); return { status: "applied" as const };
  } } }, domains: {
    library: { queries: { books: {
      searchLocations: async (input: any) => { searches.push(input); return input.cursor
        ? { bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 }
        : { bookId: "book", contentVersion: "v1", hits: [{ id: "one", sectionIndex: 0, range, location: range,
          excerpt: { pre: "before ", match: "needle", post: " after" } }], nextCursor: "next", textStatus: "partial", scannedSections: 0, totalSections: 1 }; },
      readRange: async (input: BookRangeQuery) => { reads.push(input); return { range: input.range, sectionIndex: 0,
        text: input.offset ? "dle" : "nee", offset: input.offset ?? 0, totalLength: 6, nextOffset: input.offset ? null : 3,
        context: { before: "before ", after: " after" } }; },
    } } },
    reading: { commands: { goTo: async (target: unknown) => { jumps.push(target); } } },
  } } as unknown as PluginContext;
  return { ctx, range, reads, jumps, searches, updates };
}
async function mount(view: PluginView, id = "channel") {
  const subscription = await view.live!.subscribe({ id });
  await Bun.sleep(0);
  return subscription;
}

test("selection composition consumes the captured source and never restamps a missing legacy anchor", async () => {
  const { ctx, range, reads, jumps } = fixture();
  const missing = await capturedRangeDetail(ctx, null);
  expect(missing.actions).toBeUndefined(); expect(reads).toEqual([]);
  await capturedRangeDetail(ctx, range);
  expect(reads).toEqual([{ range }]); expect(jumps).toEqual([]);
});

test("passage form validates before queries; result selection reads without moving the reader", async () => {
  const { ctx, range, reads, jumps, searches, updates } = fixture();
  const form = rangeSearchForm(ctx, "book");
  for (const query of [" ", "x".repeat(501)]) expect(await form.onSubmit({ query })).toHaveProperty("fieldErrors.query");
  expect(searches).toEqual([]);
  const result = await form.onSubmit({ query: " needle ", matchCase: true, wholeWords: false });
  expect(result!.view).toMatchObject({ kind: "blocks", blocks: [{ kind: "progress", value: null }] });
  await mount(result!.view!);
  expect(searches).toEqual([
    { bookId: "book", query: "needle", matchCase: true, wholeWords: false, limit: 20 },
    { bookId: "book", query: "needle", matchCase: true, wholeWords: false, limit: 20, cursor: "next", contentVersion: "v1" },
  ]);
  const list = updates[updates.length - 1]!.view as PluginListView;
  const selected = await list.items[0].onSelect!();
  expect(reads).toEqual([{ range }]);
  expect(jumps).toEqual([]);
  const detail = selected!.view as PluginDetailView;
  expect(detail.content[1]).toMatchObject({ kind: "quote", text: "nee", caption: "1-3 / 6" });
  await detail.actions!.find(a => a.id === "next")!.run();
  expect(reads[1]).toEqual({ range, offset: 3 });
  await detail.actions!.find(a => a.id === "open-passage")!.run();
  expect(jumps).toEqual([range]);
});

test("stale reads and failed searches reject, never display a fabricated empty or usable passage", async () => {
  const { ctx, range } = fixture();
  const failure = Object.assign(Error("internal detail"), { code: "reader/stale-location" });
  ctx.domains.library!.queries.books.readRange = async () => { throw failure; };
  await expect(rangeDetail(ctx, { range })).rejects.toBe(failure);
  ctx.domains.library!.queries.books.searchLocations = async () => { throw failure; };
  await expect(rangeResults(ctx, { bookId: "book", query: "needle" })).resolves.toMatchObject({ emptyText: "The book changed; search again", items: [] });
});

test("select passage composes open-if-needed with versioned selection and waits before closing", async () => {
  const { ctx, range } = fixture();
  const calls: unknown[] = []; let release!: () => void;
  ctx.domains.reading!.queries = { session: async () => ({ bookId: "other", status: "ready" }) } as NonNullable<PluginContext["domains"]["reading"]>["queries"];
  ctx.domains.reading!.commands!.openBook = async bookId => {
    calls.push(["open", bookId]); return { status: "completed", sessionId: "opened", location: range };
  };
  ctx.domains.reading!.commands!.selectRange = async (...args) => {
    calls.push(["select", ...args]); await new Promise<void>(resolve => { release = resolve; });
    return { status: "completed", sessionId: "opened", selection: null };
  };
  const view = await rangeDetail(ctx, { range }); let done = false;
  const pending = Promise.resolve(view.actions!.find(a => a.id === "select-passage")!.run()).then(value => { done = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(done).toBe(false); expect(calls).toEqual([["open", "book"], ["select", range, { bookId: "book", sessionId: "opened" }]]);
  release(); expect(await pending).toEqual({ close: true });
  ctx.domains.reading!.commands!.selectRange = async () => { throw Error("stale range"); };
  await expect(view.actions!.find(a => a.id === "select-passage")!.run()).rejects.toThrow("stale range");
});
