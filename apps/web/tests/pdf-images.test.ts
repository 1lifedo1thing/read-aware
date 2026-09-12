import { expect, test } from "bun:test";
import { pdfImageCandidates, readPDFImage, type PDFImagePage } from "../foliate-js/src/pdf-images";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { listImagesInBook, readImageInBook } from "../src/features/library/lib/book-images";
import type { Book } from "../foliate-js/src/book";

const source = { bookId: "pdf", contentVersion: "v1", sectionIndex: 0 };
function page(): PDFImagePage {
  return { getOperatorList: async () => ({ fnArray: [85, 83, 86], argsArray: [["img"], [{}], [{ width: 2, height: 1, kind: 1, data: new Uint8Array([128]) }]] }),
    objs: { has: () => true, get: () => ({ width: 1, height: 1, kind: 2, data: new Uint8Array([255, 0, 0]) }) }, commonObjs: { has: () => false, get: () => null } };
}
test("PDF object/inline images decode with bounded pixels while paint-state masks remain unsupported", async () => {
  const pdf = page();
  expect(await pdfImageCandidates(pdf)).toHaveLength(3);
  let bytes: number[] = [];
  const encode = async ({ rgba }: { rgba?: Uint8ClampedArray }) => { bytes = Array.from(rgba ?? []); return new Blob(["png"], { type: "image/png" }); };
  expect((await readPDFImage(pdf, 0, undefined, encode))?.type).toBe("image/png");
  expect(bytes).toEqual([255, 0, 0, 255]);
  expect(await readPDFImage(pdf, 1, undefined, encode)).toBeNull();
  await readPDFImage(pdf, 2, undefined, encode);
  expect(bytes).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  pdf.objs.get = () => ({ width: 8193, height: 1, kind: 2, data: new Uint8Array() });
  await expect(readPDFImage(pdf, 0, undefined, encode)).rejects.toMatchObject({ code: "library/content-budget-exceeded" });
});

test("PDF image discovery/read use the original page fence and descriptor; unsupported is not an empty book", async () => {
  let reads = 0;
  const pdf = page();
  const book: Book = { sections: [{ id: "page:1", size: 1000, load: () => "",
    getImages: async signal => { reads++; return (await pdfImageCandidates(pdf, signal)).map(() => ({ alt: "" })); },
    readImage: (index, signal) => readPDFImage(pdf, index, signal, async () => new Blob(["png"], { type: "image/png" })),
  }] };
  await expect(listImagesInBook(book, source, contentCFI, new Set())).rejects.toMatchObject({ code: "library/range-forbidden" });
  expect(reads).toBe(0);
  const list = await listImagesInBook(book, { ...source, limit: 1 }, contentCFI);
  expect(list).toMatchObject({ status: "available", total: 3, nextOffset: 1 });
  expect(await readImageInBook(book, { image: list.items[0].image }, contentCFI)).toMatchObject({ status: "ready", image: { location: { cfi: contentCFI(book, 0) } } });
  expect(await readImageInBook(book, { image: { ...source, index: 1 } }, contentCFI)).toMatchObject({ status: "unsupported" });
  expect(await readImageInBook(book, { image: { ...source, index: 99 } }, contentCFI)).toMatchObject({ status: "missing" });
});

test("waiting for PDF worker image transfer can be cancelled without registering permanent callbacks", async () => {
  const pdf = page(); pdf.objs.has = () => false;
  const controller = new AbortController();
  const pending = readPDFImage(pdf, 0, controller.signal);
  setTimeout(() => controller.abort(new Error("cancel image")), 5);
  await expect(pending).rejects.toThrow("cancel image");
});
