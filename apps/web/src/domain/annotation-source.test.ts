import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError, type BookRangePage } from "@read-aware/core";
import * as ranges from "../features/library/lib/book-range";
import * as states from "./book-content-state";
import { prepareAnnotationSource } from "./annotation-source";

const range = { bookId: "book", contentVersion: "sha256:old", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)" };
const source = { bookId: "book", source: "file" as const, availability: "local" as const, sourceRevision: "sha256:old", contentVersion: "sha256:old" };
const page: BookRangePage = { range, text: "Quote", offset: 0, totalLength: 5, nextOffset: null, sectionIndex: 0, context: { before: "", after: "" } };
const cleanups: (() => void)[] = [];
const own = <T extends { mockRestore(): void }>(spy: T): T => { cleanups.push(() => spy.mockRestore()); return spy; };
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  return { read: own(spyOn(ranges, "readBookRange").mockResolvedValue(page)), state: own(spyOn(states, "getBookContentState").mockResolvedValue(source)) };
}

test("source validation compares the entire paged quote and returns the canonical range", async () => {
  const f = fixture();
  const canonical = { ...range, cfi: "epubcfi(/6/2!/4/4,/1:0,/1:5)" };
  f.read.mockImplementation(async query => query.offset === 0
    ? { ...page, range: canonical, text: "Qu", nextOffset: 2 }
    : { ...page, range: canonical, offset: 2, text: "ote" });
  const controller = new AbortController();
  const result = await prepareAnnotationSource({ bookId: "book", range, text: "Quote" }, controller.signal);
  expect(result.range).toEqual(canonical);
  expect(f.read.mock.calls.map(call => call[0].offset)).toEqual([0, 2]);
  expect(f.read.mock.calls.every(call => call[1] === controller.signal)).toBe(true);
  f.state.mockResolvedValue({ ...source, sourceRevision: "sha256:new" });
  await expect(result.beforeDispatch()).rejects.toMatchObject({ code: "reader/stale-location" });
});

test("wrong book, competing chapter, missing quote, preview, and forged quote are rejected", async () => {
  const f = fixture();
  for (const input of [
    { bookId: "other", range, text: "Quote" },
    { bookId: "book", range, text: "Quote", chapterHref: "other.xhtml" },
    { bookId: "book", range, text: "" },
    { bookId: "book", range, text: "Qu" },
    { bookId: "book", range, text: "Wrong" },
  ]) await expect(prepareAnnotationSource(input)).rejects.toMatchObject({ code: "annotations/invalid-input" });
  expect(f.read).toHaveBeenCalledTimes(2);
});

test("invalid page termination and gaps cannot masquerade as a complete source", async () => {
  const f = fixture();
  for (const bad of [{ text: "Qu", nextOffset: null }, { text: "Qu", nextOffset: 3 }, { offset: 1 }]) {
    f.read.mockResolvedValue({ ...page, ...bad });
    await expect(prepareAnnotationSource({ bookId: "book", range, text: "Quote" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
  }
});

test("parser staleness, virtual provider changes and cancellation retain their failure boundary", async () => {
  const f = fixture();
  f.read.mockRejectedValue(new AppError("reader/stale-location", "Changed"));
  await expect(prepareAnnotationSource({ bookId: "book", range, text: "Quote" })).rejects.toMatchObject({ code: "reader/stale-location" });
  f.read.mockResolvedValue(page);
  const virtual = { ...source, source: "virtual" as const, availability: "provider-registered" as const, contentVersion: null, sourceRevision: "activation:1" };
  f.state.mockResolvedValue(virtual);
  const result = await prepareAnnotationSource({ bookId: "book", range, text: "Quote" });
  f.state.mockResolvedValue({ ...virtual, sourceRevision: "activation:2" });
  await expect(result.beforeDispatch()).rejects.toMatchObject({ code: "reader/stale-location" });
  const controller = new AbortController();
  const cancelled = await prepareAnnotationSource({ bookId: "book", range, text: "Quote" }, controller.signal);
  controller.abort();
  await expect(cancelled.beforeDispatch()).rejects.toHaveProperty("name", "AbortError");
});
