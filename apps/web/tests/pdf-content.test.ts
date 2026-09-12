import { expect, test } from "bun:test";
import { readPDFReferences, readPDFPageText } from "../foliate-js/src/pdf-content";
import { CONTENT_QUERY_MAX_CHARS, CONTENT_QUERY_MAX_SOURCE_BYTES } from "../foliate-js/src/content-budget";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { resolvePDFHref } from "../foliate-js/src/pdf-navigation";
import type { Book } from "../foliate-js/src/book";
import type { PDFPage } from "../foliate-js/src/vendor/pdfjs/pdf.mjs";
import { listReferencesInBook, readReferenceInBook } from "../src/features/library/lib/book-references";
import { withDom } from "./helpers/foliate-dom";

const source = { bookId: "pdf", contentVersion: "sha256:fixture", sectionIndex: 0 };
const ref = (index: number) => ({ ...source, index });
const records = [
  { subtype: "Link", dest: [1, { name: "Fit" }], contentsObj: { str: "Target" } },
  { subtype: "Text", titleObj: { str: "Author" }, contentsObj: { str: "Note 😀 text" } },
  { subtype: "Link", url: "https://example.com" },
  { subtype: "Link", unsafeUrl: "javascript:alert(1)" },
  { subtype: "Link", action: "NextPage" },
  { subtype: "Widget", contents: "secret form field" },
];
test("non-DOM PDF references use bounded source descriptors and fence destinations before reading", async () => {
  let targetReads = 0;
  const book: Book = { sections: [
    { id: "page:1", size: 1000, load: () => "", getReferences: signal => readPDFReferences({ getAnnotations: async () => records }, signal) },
    { id: "page:2", size: 1000, load: () => "", getText: () => { targetReads++; return "Final chapter text"; } },
  ], resolveHref: href => resolvePDFHref({ numPages: 2, getDestination: async () => null, getPageIndex: async () => 1 }, href) };
  const list = await listReferencesInBook(book, { ...source, limit: 2 });
  expect(list).toMatchObject({ status: "available", total: 5, nextOffset: 2 });
  expect(list.items[0]).toEqual({ reference: ref(0), kind: "link", label: "Target" });
  expect(JSON.stringify(list)).not.toContain("https:");
  await expect(readReferenceInBook(book, { reference: ref(0) }, contentCFI, new Set([0])))
    .rejects.toMatchObject({ code: "library/range-forbidden" });
  expect(targetReads).toBe(0);
  expect(await readReferenceInBook(book, { reference: ref(0), limit: 6 }, contentCFI)).toMatchObject({
    status: "resolved", text: "Final ", totalLength: 18, nextOffset: 6,
    location: { bookId: "pdf", contentVersion: source.contentVersion, cfi: contentCFI(book, 1) },
  });
  expect(await readReferenceInBook(book, { reference: ref(1), offset: 5, limit: 2 }, contentCFI)).toMatchObject({ text: "😀", nextOffset: 7 });
  expect(await readReferenceInBook(book, { reference: ref(2) }, contentCFI)).toMatchObject({ status: "external", url: "https://example.com/" });
  for (const index of [3, 4]) expect(await readReferenceInBook(book, { reference: ref(index) }, contentCFI)).toMatchObject({ status: "blocked" });
  expect(await readReferenceInBook(book, { reference: ref(99) }, contentCFI)).toMatchObject({ status: "missing" });
});

test("PDF streamed text cancels on budget failure and while awaiting a chunk", async () => {
  let cancelled = 0;
  const oversized: Pick<PDFPage, "streamTextContent"> = { streamTextContent: () => new ReadableStream({ start(controller) {
    controller.enqueue({ items: [{ str: "x".repeat(CONTENT_QUERY_MAX_CHARS), dir: "ltr", transform: [], width: 0, height: 0, fontName: "f", hasEOL: false }], styles: {}, lang: null });
  }, cancel() { cancelled++; } }) };
  await expect(readPDFPageText(oversized)).rejects.toMatchObject({ code: "library/content-budget-exceeded" });
  expect(cancelled).toBe(1);
  const controller = new AbortController();
  const pending = readPDFPageText({ streamTextContent: () => new ReadableStream({ cancel() { cancelled++; } }) }, controller.signal);
  controller.abort(new Error("stop waiting"));
  await expect(pending).rejects.toThrow("stop waiting");
  expect(cancelled).toBe(2);
  await expect(readPDFReferences({ getAnnotations: async () => [{ subtype: "Text", contents: "x".repeat(CONTENT_QUERY_MAX_CHARS + 1) }] }))
    .rejects.toMatchObject({ code: "library/content-budget-exceeded" });
});

test("oversized DOM reference sources fail before parse when sized and before cloning when underreported", () => withDom(async () => {
  let parses = 0;
  const section = { id: "chapter", size: CONTENT_QUERY_MAX_SOURCE_BYTES + 1, load: () => "",
    createDocument: () => { parses++; return new DOMParser().parseFromString('<a href="#note">Note</a>', "text/html"); } };
  await expect(listReferencesInBook({ sections: [section] }, source)).rejects.toMatchObject({ code: "library/content-budget-exceeded" });
  expect(parses).toBe(0);
  section.size = 1;
  const doc = section.createDocument();
  doc.body.append(doc.createTextNode("x".repeat(CONTENT_QUERY_MAX_CHARS + 1)));
  section.createDocument = () => doc;
  await expect(listReferencesInBook({ sections: [section] }, source)).rejects.toMatchObject({ code: "library/content-budget-exceeded" });
}));
