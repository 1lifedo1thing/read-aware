import { expect, test } from "bun:test";
import cases from "../../../../../desktop/src-tauri/src/storage/reading_progress_cases.json";
import { compareReadingProgress, createProgressPatch } from "./library-progress";
import type { LibraryBook, ReaderProgress } from "./library-types";

const progress = (value: object): ReaderProgress => ({ currentLocation: 0, totalLocations: 0, progressPercent: 0, cfi: null, href: null, ...value });

test("optimistic ordering agrees with native storage fixtures", () => {
  for (const entry of cases) {
    expect(Math.sign(compareReadingProgress(progress(entry.left), progress(entry.right))), entry.name).toBe(entry.order);
  }
});

test("optimistic shelf progress retains the farther anchor and advances within one percent", () => {
  const old = progress({ currentLocation: 300, totalLocations: 1000, progressPercent: 30, cfi: "epubcfi(/6/2!/4/2/1:300)" });
  const book = { id: "book", progress: old, progressPercent: 30, readingStatus: "reading" } as LibraryBook;
  expect(createProgressPatch(book, progress({ currentLocation: 200, totalLocations: 1000, progressPercent: 20 })).progress).toEqual(old);
  expect(createProgressPatch(book, progress({ currentLocation: 301, totalLocations: 1000, progressPercent: 30 })).progress?.currentLocation).toBe(301);
});
