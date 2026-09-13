import { expect, test } from "bun:test";
import type { BookLocationHit, BookLocationSearchPage } from "@read-aware/core";
import { searchAllBookLocations } from "./book-location-search";

const hit = (id: string, text = "needle"): BookLocationHit => ({
  id, sectionIndex: 0,
  excerpt: { pre: "before ", match: text, post: " after" },
  location: { bookId: "book", contentVersion: "v1", href: "section-1" },
  range: { bookId: "book", contentVersion: "v1", cfi: `epubcfi(${id})` },
});

const page = (scannedSections: number, totalSections: number, hits: BookLocationHit[] = [], nextCursor: string | null = null,
  contentVersion = "v1"): BookLocationSearchPage => ({
  bookId: "book", contentVersion, hits, nextCursor,
  textStatus: nextCursor ? "partial" : "available", scannedSections, totalSections,
});

test("serially consumes every page, forwards the pinned version, and reports progress", async () => {
  const requests: Array<{ cursor?: string; contentVersion?: string }> = [];
  const progress: number[] = [];
  const result = await searchAllBookLocations(async input => {
    requests.push({ cursor: input.cursor, contentVersion: input.contentVersion });
    if (!input.cursor) return page(1, 3, [hit("one")], "cursor-1");
    if (input.cursor === "cursor-1") return page(2, 3, [hit("two")], "cursor-2");
    return page(3, 3, [hit("three")]);
  }, { bookId: "book", query: "needle" }, { onProgress: value => { progress.push(value.scannedSections); } });

  expect(result).toMatchObject({ status: "completed", contentVersion: "v1", scannedSections: 3, totalSections: 3 });
  expect(result.hits.map(value => value.id)).toEqual(["one", "two", "three"]);
  expect(requests.map(value => value.cursor)).toEqual([undefined, "cursor-1", "cursor-2"]);
  expect(requests.map(value => value.contentVersion)).toEqual([undefined, "v1", "v1"]);
  expect(progress).toEqual([1, 2, 3]);
});

test("stale content discards all locations and repeated cursors reject as invalid pages", async () => {
  const stale = await searchAllBookLocations(async () => { throw Object.assign(Error("stale"), { code: "reader/stale-location" }); },
    { bookId: "book", query: "needle" });
  expect(stale).toMatchObject({ status: "stale", contentVersion: null, hits: [] });

  let versionCalls = 0;
  const changedVersion = await searchAllBookLocations(async input => {
    versionCalls++;
    return input.cursor
      ? page(2, 2, [hit("discarded")], null, "v2")
      : page(1, 2, [hit("kept-until-stale")], "next", "v1");
  }, { bookId: "book", query: "needle" });
  expect(changedVersion).toMatchObject({ status: "stale", contentVersion: null, hits: [] });
  expect(versionCalls).toBe(2);

  await expect(searchAllBookLocations(async input => input.cursor
    ? page(1, 2, [hit("late")], input.cursor)
    : page(1, 2, [hit("first")], "same"), { bookId: "book", query: "needle" })).rejects.toMatchObject({ code: "library/search-invalid-page" });
  await expect(searchAllBookLocations(async () => undefined as unknown as BookLocationSearchPage,
    { bookId: "book", query: "needle" })).rejects.toMatchObject({ code: "library/search-invalid-page" });
});

test("result and section limits are terminal and never fetch another page", async () => {
  let calls = 0;
  const result = await searchAllBookLocations(async () => {
    calls++;
    return page(1, 4, [hit("one"), hit("two")], "more");
  }, { bookId: "book", query: "needle" }, { maxHits: 1 });
  expect(result).toMatchObject({ status: "result-limit", scannedSections: 1, totalSections: 4 });
  expect(result.hits.map(value => value.id)).toEqual(["one"]);
  expect(calls).toBe(1);

  calls = 0;
  const scan = await searchAllBookLocations(async () => {
    calls++;
    return page(1, 4, [], "more");
  }, { bookId: "book", query: "needle" }, { maxSections: 1 });
  expect(scan).toMatchObject({ status: "scan-limit", hits: [], scannedSections: 1, totalSections: 4 });
  expect(calls).toBe(1);
});

test("cancellation and deadline return promptly even when a page reader never settles", async () => {
  const cancel = new AbortController();
  let cancelledSignal: AbortSignal | undefined;
  const cancellation = searchAllBookLocations((_input, options) => {
    cancelledSignal = options?.signal;
    return new Promise<BookLocationSearchPage>(() => {});
  }, { bookId: "book", query: "needle" }, { signal: cancel.signal, timeoutMs: 1000 });
  cancel.abort();
  await expect(cancellation).resolves.toMatchObject({ status: "cancelled", hits: [] });
  expect(cancelledSignal?.aborted).toBe(true);

  let timedSignal: AbortSignal | undefined;
  const started = performance.now();
  const timeout = searchAllBookLocations((_input, options) => {
    timedSignal = options?.signal;
    return new Promise<BookLocationSearchPage>(() => {});
  }, { bookId: "book", query: "needle" }, { timeoutMs: 5 });
  await expect(timeout).resolves.toMatchObject({ status: "timed-out", hits: [] });
  expect(performance.now() - started).toBeLessThan(500);
  expect(timedSignal?.aborted).toBe(true);
});

test("the deadline also bounds an async progress callback", async () => {
  let pageSignal: AbortSignal | undefined;
  const started = performance.now();
  const timeout = searchAllBookLocations(async (_input, options) => {
    pageSignal = options?.signal;
    return page(1, 1, [hit("one")]);
  }, { bookId: "book", query: "needle" }, {
    timeoutMs: 5,
    onProgress: () => new Promise<void>(() => {}),
  });

  await expect(timeout).resolves.toMatchObject({ status: "timed-out", hits: [] });
  expect(performance.now() - started).toBeLessThan(500);
  expect(pageSignal?.aborted).toBe(true);
});

test("an excerpt byte cap does not truncate a hit", async () => {
  const result = await searchAllBookLocations(async () => page(1, 1, [hit("large", "x")]),
    { bookId: "book", query: "needle" }, { maxExcerptBytes: 128 });
  expect(result).toMatchObject({ status: "result-limit", hits: [] });
});
