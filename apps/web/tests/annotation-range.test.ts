import { afterEach, expect, spyOn, test } from "bun:test";
import type { Book } from "../foliate-js/src/book";
import { captureContentRange, readContentRange } from "../foliate-js/src/content-range";
import * as ranges from "../src/features/library/lib/book-range";
import * as states from "../src/domain/book-content-state";
import { prepareAnnotationSource } from "../src/domain/annotation-source";
import { withDom } from "./helpers/foliate-dom";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const own = <T extends { mockRestore(): void }>(spy: T): T => { cleanups.push(() => spy.mockRestore()); return spy; };

test("captured DOM and PDF source ranges validate with the actual parser before annotation dispatch", () => withDom(async () => {
  document.body.innerHTML = '<div class="textLayer"><span>Before nee dle after</span></div>';
  const selected = document.createRange();
  selected.setStart(document.querySelector("span")!.firstChild!, 7);
  selected.setEnd(document.querySelector("span")!.firstChild!, 14);
  own(spyOn(states, "getBookContentState").mockResolvedValue({ bookId: "book", source: "file", availability: "local", sourceRevision: "sha256:old", contentVersion: "sha256:old" }));
  for (const section of [
    { createDocument: () => document },
    { getText: async () => "Before nee dle after" },
  ]) {
    const book: Book = { sections: [{ id: "one", size: 20, load: () => "", ...section }] };
    const captured = captureContentRange(book, 0, selected);
    const range = { bookId: "book", contentVersion: "sha256:old", ...captured };
    const read = spyOn(ranges, "readBookRange").mockImplementation(async (query, signal) => {
      const page = await readContentRange(book, query.range, { offset: query.offset ?? 0, limit: query.limit ?? 4000, contextChars: 0 }, () => {}, signal);
      return { ...page, range: { ...query.range, cfi: page.cfi }, offset: query.offset ?? 0 };
    });
    try {
      const source = await prepareAnnotationSource({ bookId: "book", range, text: "nee dle" });
      expect(source.range).toEqual(range);
      await expect(prepareAnnotationSource({ bookId: "book", range, text: "forged!" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
      if (range.textQuote) {
        // PDF resolution folds whitespace in selectors; preserve that selector
        // while requiring the stored quote to match actual parser text.
        const selector = { ...range, textQuote: { ...range.textQuote, exact: "needle" } };
        expect((await prepareAnnotationSource({ bookId: "book", range: selector, text: "nee dle" })).range).toEqual(selector);
      }
    } finally { read.mockRestore(); }
  }
}));
