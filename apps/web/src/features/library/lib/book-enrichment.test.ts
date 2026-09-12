import { withDomainBackup } from "../../../platform/domain-write-gate";
import * as ipc from "../../../platform/ipc";
import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import * as library from "./library-db";
import * as events from "../../../platform/domain-events";
import { pendingImportPlaceholder } from "./book-import";
import { enrichFromOpenBook, enrichmentQueue, metadataNeedsEnrichment } from "./book-enrichment";
import type { FoliateBook } from "../../reader/lib/foliate-engine";

const restore: Array<() => void> = [];
afterEach(() => { for (const cleanup of restore.splice(0).reverse()) cleanup(); });
function fixture() {
  const book = pendingImportPlaceholder(crypto.randomUUID(), { kind: "native-path", path: "/private/book.pdf", name: "book.pdf", size: 10 }, "pdf");
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  const commit = spyOn(events, "commitDomainEvents").mockResolvedValue({ appended: 1, applied: 1 });
  restore.push(() => get.mockRestore(), () => commit.mockRestore());
  return { book, get, commit };
}

test("cover extraction failure stays retryable instead of committing a false no-cover verdict", async () => {
  const f = fixture(); f.book.title = "Custom title";
  const parsed = { metadata: {}, sections: [], getCover: async () => { throw new AppError("fs/not-found", "missing image"); } } as unknown as FoliateBook;
  await enrichFromOpenBook(f.book, parsed);
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "failed", errorCode: "fs/not-found" });
  expect(f.commit).not.toHaveBeenCalled();
  parsed.getCover = async () => null;
  await enrichFromOpenBook(f.book, parsed);
  expect(enrichmentQueue.snapshot(f.book.id).phase).toBe("completed");
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({ type: "book.coverExtracted", payload: { status: "none" } });
});

test("parsed metadata keeps observed custom fields and retry eligibility covers non-PDF formats", async () => {
  const f = fixture(); f.book.coverStatus = "none";
  const latest = { ...f.book, title: "My title", author: "My author" };
  f.get.mockResolvedValue(latest);
  const parsed = { metadata: { title: "Parsed title", author: "Parsed author" }, sections: [] } as unknown as FoliateBook;
  await enrichFromOpenBook(f.book, parsed);
  expect(f.commit).not.toHaveBeenCalled();
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "skipped", reason: "not-needed" });
  expect(metadataNeedsEnrichment({ ...f.book, format: "epub" })).toBe(true);
  expect(metadataNeedsEnrichment({ ...latest, format: "epub" })).toBe(false);
});

test("cover preparation may await backup, but file persistence and its verdict drain together", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let prepared = false;
  const parsed = { metadata: {}, sections: [], getCover: async () => {
    await withDomainBackup(async () => { prepared = true; });
    return new Blob(["cover"], { type: "image/png" });
  } } as unknown as FoliateBook;
  const invoke = spyOn(ipc, "invoke").mockImplementation(async <T>() => {
    entered.resolve(); await release.promise; return { coverBlobKey: `cover:${f.book.id}` } as T;
  });
  restore.push(() => invoke.mockRestore());
  const work = enrichFromOpenBook(f.book, parsed);
  await entered.promise; expect(prepared).toBe(true);
  let captured = false;
  const backup = withDomainBackup(async () => { captured = true; expect(f.commit).toHaveBeenCalled(); });
  await Bun.sleep(0); expect(captured).toBe(false);
  release.resolve(); await work; await backup;
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({ type: "book.coverExtracted", payload: { status: "ready" } });
});

test("a book removed during cover preparation is rechecked before writing any cover or verdict", async () => {
  const f = fixture();
  const parsed = { metadata: {}, sections: [], getCover: async () => {
    f.get.mockResolvedValue(null); return new Blob(["cover"]);
  } } as unknown as FoliateBook;
  const invoke = spyOn(ipc, "invoke").mockImplementation(async () => { throw Error("must not write a removed book"); });
  restore.push(() => invoke.mockRestore());
  await enrichFromOpenBook(f.book, parsed);
  expect(invoke).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "skipped", reason: "book-removed" });
});
