import { appDataDir } from "@tauri-apps/api/path";
import { createLibraryDomain } from "../../src/domain/library";
import { getDesktopBlob, putDesktopBlob } from "../../src/platform/blob-store";
import { commitDomainEvents } from "../../src/platform/domain-events";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { buildEnrichmentTools } from "../../../../packages/agent/src/tools/enrichment-tools";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { emitAppEvent } from "../../src/platform/app-events";
import { parseFileName } from "../../src/features/library/lib/book-file-name";

let bookId: string | undefined;
let marker: string | undefined;
const duplicateIds: string[] = [];
let enrichmentId: string | undefined;
let enrichmentSource: Uint8Array | undefined;

async function isolated() {
  const path = await appDataDir();
  if (!/\/com\.readaware\.app\.(capability-e2e|validation-backup-e2e)$/.test(path.replace(/[/\\]$/, ""))) throw Error("Requires isolated acceptance profile");
  return path;
}

export async function prepareLibraryContent() {
  const path = await isolated();
  if (marker) throw Error("Acceptance already owns resources");
  marker = `Composition ${crypto.randomUUID().slice(0, 8)}`;
  const canvas = document.createElement("canvas");
  canvas.width = 240; canvas.height = 160;
  const painter = canvas.getContext("2d")!;
  painter.fillStyle = "#e53935"; painter.fillRect(0, 0, 120, 160);
  painter.fillStyle = "#159447"; painter.fillRect(120, 0, 120, 160);
  painter.fillStyle = "#ffffff"; painter.fillRect(80, 50, 80, 60);
  const png = canvas.toDataURL("image/png").split(",")[1];
  const source = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>science</genre><author><first-name>Fixture</first-name><last-name>Author</last-name></author><book-title>${marker}</book-title><coverpage><image l:href="#picture"/></coverpage><lang>en</lang></title-info><document-info><author><nickname>ReadAware Tests</nickname></author><date>2026-09-11</date><id>${marker}</id><version>1.0</version></document-info></description>
<body><section id="first"><title><p>Illustrated section</p></title><p>Deterministic acceptance content with a note <a l:href="#note-one" type="note">1</a>.</p><image l:href="#picture"/><p>Red left, green right, white center.</p></section><section id="second"><title><p>Second section</p></title><p>A second source section for navigation.</p></section></body>
<body name="notes"><section id="note-one"><title><p>1</p></title><p>Acceptance footnote: the source is a local test book.</p></section></body><binary id="picture" content-type="image/png">${png}</binary></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: `${marker}.fb2`, data: new TextEncoder().encode(source) });
  bookId = book.id;
  return { path, marker, bookId };
}

export async function inspectLibraryContent() {
  await isolated();
  const library = createLibraryDomain("user");
  return { marker, book: bookId ? await library.queries.books.get(bookId) : null,
    collections: (await library.queries.collections.list()).filter(collection => marker && collection.name.startsWith(marker)) };
}

/** Model independently imported same-content records at the native event seam.
 * This deliberately bypasses local import dedupe, not merge validation. */
export async function prepareLibraryDuplicates() {
  await isolated();
  if (!bookId || !marker || duplicateIds.length) throw Error("Prepare one owned book first");
  const library = createLibraryDomain("user");
  const bytes = await getDesktopBlob(`bookfile:${bookId}`);
  if (!bytes) throw Error("Owned source missing");
  for (let index = 0; index < 2; index++) {
    const id = crypto.randomUUID();
    duplicateIds.push(id);
    const blob = await putDesktopBlob(`bookfile:${id}`, bytes);
    await commitDomainEvents({ type: "book.imported", origin: "user", payload: {
      bookId: id, title: `${marker} duplicate ${index + 1}`, author: "Duplicate fixture",
      format: "fb2", fileName: `${marker}.fb2`, fileSize: bytes.length,
      sourceBlobKey: `bookfile:${id}`, sourceSha256: blob.sha256,
    } });
  }
  const annotations = createAnnotationsDomain("user");
  const notes = [];
  for (const id of [bookId, ...duplicateIds]) {
    notes.push(await annotations.commands.createNote({ bookId: id, body: `${marker} note ${id}` }));
    await commitDomainEvents({ type: "book.timeRecorded", origin: "user", payload: {
      bookId: id, ms: 1000, atEpochMs: Date.now(), localDay: "2026-09-13", localHour: 10,
    } });
  }
  await library.commands.books.setStarred(duplicateIds[0]!, true);
  const collection = await library.commands.collections.create(`${marker} merge shelf`);
  await library.commands.collections.assignBooks([duplicateIds[0]!], collection.id);
  return { keepId: bookId, duplicateIds: [...duplicateIds], notes, collection,
    preview: await library.queries.books.previewMerge(bookId) };
}

/** An interrupted local source at the native event seam, not an import parser mock. */
export async function prepareEnrichmentFixture() {
  await isolated();
  if (!bookId || !marker || enrichmentId) throw Error("Prepare one owned source first");
  const source = await getDesktopBlob(`bookfile:${bookId}`);
  if (!source) throw Error("Owned source missing");
  enrichmentSource = source;
  enrichmentId = crypto.randomUUID();
  const broken = new TextEncoder().encode("<invalid>Interrupted enrichment fixture</invalid>");
  const blob = await putDesktopBlob(`bookfile:${enrichmentId}`, broken);
  await commitDomainEvents({ type: "book.imported", origin: "user", payload: {
    bookId: enrichmentId, title: "Enrichment source probe", author: "", format: "fb2",
    fileName: "Enrichment source probe.fb2", fileSize: broken.length,
    sourceBlobKey: `bookfile:${enrichmentId}`, sourceSha256: blob.sha256,
  } });
  return { enrichmentId, sourceBookId: bookId, embeddedTitle: marker };
}

export async function restoreEnrichmentFixtureSource() {
  await isolated();
  if (!enrichmentId || !enrichmentSource) throw Error("No owned enrichment fixture");
  const library = createLibraryDomain("user");
  await library.commands.books.editMetadata(enrichmentId, { title: "Enrichment user chosen title" });
  await putDesktopBlob(`bookfile:${enrichmentId}`, enrichmentSource);
  return { enrichmentId, restored: true };
}

export async function agentEnrichmentFixture(retry = false) {
  await isolated();
  if (!enrichmentId) throw Error("No owned enrichment fixture");
  const tool = buildEnrichmentTools({ kind: "book", bookId: enrichmentId }, buildRuntimeDeps())
    .find(tool => tool.name === (retry ? "retry_book_enrichment" : "get_book_enrichment"))!;
  return tool.execute("enrichment-fixture", {});
}

export async function prepareAutomaticPdfEnrichment() {
  await isolated();
  if (!bookId || !marker || enrichmentId) throw Error("Prepare one owned source first");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Enrichment embedded PDF title"); pdf.setAuthor("Enrichment PDF author");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 600]).drawText("Automatic enrichment PDF fixture", { font, x: 30, y: 500, size: 16 });
  const bytes = await pdf.save(); enrichmentId = crypto.randomUUID();
  const blob = await putDesktopBlob(`bookfile:${enrichmentId}`, bytes);
  const fileName = "Enrichment unfinished PDF.pdf";
  await commitDomainEvents({ type: "book.imported", origin: "user", payload: {
    bookId: enrichmentId, ...parseFileName(fileName), format: "pdf",
    fileName, fileSize: bytes.length,
    sourceBlobKey: `bookfile:${enrichmentId}`, sourceSha256: blob.sha256,
  } });
  // Use the ordinary shelf reload/catch-up path; do not enqueue directly.
  emitAppEvent("library-changed", {});
  return { enrichmentId };
}

export async function cleanupLibraryContent() {
  await isolated();
  const library = createLibraryDomain("user");
  for (const collection of await library.queries.collections.list()) {
    if (marker && collection.name.startsWith(marker)) await library.commands.collections.remove(collection.id);
  }
  const removed = bookId ? await library.commands.books.removeMany([bookId, ...duplicateIds, ...(enrichmentId ? [enrichmentId] : [])]) : null;
  if (removed?.files.status === "pending") throw Error("Owned fixture file cleanup is pending");
  bookId = undefined;
  duplicateIds.length = 0;
  enrichmentId = undefined;
  enrichmentSource = undefined;
  marker = undefined;
  return { removed, remaining: (await library.queries.books.list()).map(book => ({ id: book.id, title: book.title })) };
}
