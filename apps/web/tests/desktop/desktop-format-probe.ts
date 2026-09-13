import { appDataDir } from "@tauri-apps/api/path";
import { errorCode } from "@read-aware/core";
import { createLibraryDomain } from "../../src/domain/library";
import { withBookContent, registerActiveBookContent } from "../../src/features/library/lib/book-content-source";
import { ensureBookTextExtracted, deleteBookText, getBookTextSnapshot } from "../../src/features/library/lib/book-text-store";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";

const owned = new Set<string>();
const library = createLibraryDomain("user");
const allowed = new Set(["fixture.epub","fixture.mobi","fixture.azw3","fixture.fb2.zip","fixture.cbz","fixture.cbr","truncated.cbr","fixture.txt","fixture.html","encrypted.mobi",
  "fixture.prc","fixture.azw","fixture.kf8","fixture.fbz","fixture.text","fixture.htm","fixture.xhtml"]);
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e required");
}
export async function runFormatCase(fileName: string, base64: string) {
  await isolated();
  if (!allowed.has(fileName) || base64.length > 4_000_000) throw Error("Known bounded synthetic fixtures only");
  const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const before = new Set((await library.queries.books.list()).map(book => book.id));
  const imported = await library.commands.books.importBook({fileName,data});
  if (before.has(imported.id)) throw Error("Fixture collided with an existing book; not owned by this run");
  owned.add(imported.id);
  let extraction: unknown;
  try {
    extraction = await withBookContent(imported.id,undefined,undefined,async ({book,contentVersion}) => {
      const unregister = registerActiveBookContent(imported.id,book,contentVersion);
      try {
        const chapters = await ensureBookTextExtracted(imported.id,book);
        return {sectionCount:book.sections.length,contentVersion,chapterCount:chapters.length,
          textCharacters:chapters.reduce((total,chapter) => total+chapter.text.length,0),
          titles:chapters.map(chapter => chapter.title),metadata:book.metadata};
      } finally {unregister();}
    });
  } catch (error) { extraction = {errorCode:errorCode(error),message:error instanceof Error ? error.message : String(error)}; }
  return {fileName,byteLength:data.length,imported,extraction,state:await getBookTextSnapshot(imported.id)};
}
export async function cleanupFormatProbe() {
  await isolated(); await buildRuntimeDeps().reader.close();
  const removed: string[] = [];
  for (const id of owned) {await deleteBookText([id]);await library.commands.books.remove(id);owned.delete(id);removed.push(id);}
  const remaining = await library.queries.books.list();
  return {removed,remainingOwned:remaining.filter(book => removed.includes(book.id)).length,remainingBookIds:remaining.map(book => book.id)};
}
