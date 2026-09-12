import { expect, test } from "bun:test";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { readPDFReferences, readPDFPageText } from "../foliate-js/src/pdf-content";
import { resolvePDFHref } from "../foliate-js/src/pdf-navigation";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { listReferencesInBook, readReferenceInBook } from "../src/features/library/lib/book-references";
import type { Book } from "../foliate-js/src/book";

test("real PDF.js parses PDF link destinations, notes and target text through the public query implementation", async () => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const first = source.addPage(), second = source.addPage();
  second.drawText("Target page body", { x: 30, y: 700, font });
  first.node.addAnnot(source.context.register(source.context.obj({ Type: "Annot", Subtype: "Link",
    Rect: [30, 650, 100, 670], Dest: [second.ref, PDFName.of("Fit")], Border: [0, 0, 0] })));
  first.node.addAnnot(source.context.register(source.context.obj({ Type: "Annot", Subtype: "Text",
    Rect: [30, 600, 50, 620], T: PDFString.of("Writer"), Contents: PDFString.of("Actual note") })));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: await source.save(), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const book: Book = { sections: [0, 1].map(i => ({ id: `page:${i + 1}`, size: 1000, load: () => "",
      getReferences: async signal => readPDFReferences(await pdf.getPage(i + 1), signal),
      getText: async signal => readPDFPageText(await pdf.getPage(i + 1), signal),
    })), resolveHref: href => resolvePDFHref(pdf, href) };
    const query = { bookId: "pdf", contentVersion: "fixture", sectionIndex: 0 };
    const page = await listReferencesInBook(book, query);
    expect(page.items.map(item => item.kind)).toEqual(["link", "inline-note"]);
    const target = await readReferenceInBook(book, { reference: page.items[0].reference }, contentCFI);
    expect(target).toMatchObject({ status: "resolved", text: "Target page body", location: { cfi: contentCFI(book, 1) } });
    expect(await readReferenceInBook(book, { reference: page.items[1].reference }, contentCFI))
      .toMatchObject({ status: "resolved", label: "Writer", text: "Actual note" });
  } finally { await pdf.destroy(); }
});
