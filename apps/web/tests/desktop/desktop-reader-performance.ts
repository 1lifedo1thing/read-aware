/** Run with local book copies in a disposable, foreground macOS Tauri profile.
 * Fixtures are supplied by the caller; copyrighted books never enter Git. */
import { appDataDir } from "@tauri-apps/api/path";
import { createLibraryDomain } from "../../src/domain/library";
import { createReadingDomain } from "../../src/domain/reading";
import { readingRuntime } from "../../src/domain/reading-runtime";
import type { FoliateView } from "../../src/features/reader/lib/foliate-engine";
import { getReaderPreferences, saveReaderPreferences, type ReadingMode } from "../../src/features/settings/lib/reader-settings";

type Fixture = { name: string; fileName: string; bytes: number; resumeCfi?: string };
type Measurement = { name: string; bytes: number; mode: ReadingMode; firstMs: number; navigateMs: number;
  resumeMs: number; sections: number; retained: number; visibleChars: number };

export async function runReaderPerformance(baseUrl: string, fixtures: Fixture[],
  report: (event: { stage: string; name?: string; result?: Measurement; error?: string }) => void) {
  if (!(await appDataDir()).replace(/[/\\]$/, "").includes("/com.readaware.app.reader-perf-"))
    throw new Error("Requires a disposable reader-perf profile");
  if (document.visibilityState !== "visible") throw new Error("Foreground the native window before measuring");
  const reader = createReadingDomain("user").commands;
  const library = createLibraryDomain("user").commands.books;
  const results: Measurement[] = [];
  const visibleDocument = (doc: Document) => {
    const frame = doc.defaultView?.frameElement;
    if (!frame || getComputedStyle(frame).visibility === "hidden") return false;
    const rect = frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth;
  };
  const inspect = async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const view = document.querySelector<FoliateView>("foliate-view");
    const snapshot = readingRuntime.snapshot();
    if (!view?.book || snapshot.status !== "ready" || !snapshot.location || !view.renderer)
      throw new Error("Reader did not become ready with a location");
    const contents = view.renderer.getContents();
    const painted = snapshot.visibleText.trim() || contents.some(({ doc }) => visibleDocument(doc) &&
      [...doc.querySelectorAll("img, svg, canvas")].some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (!(element instanceof doc.defaultView!.HTMLImageElement)
          || element.complete && element.naturalWidth > 0);
      }));
    if (!painted) throw new Error("Reader is ready but has no visible text or painted image");
    return { view, snapshot, retained: contents.length };
  };
  for (const fixture of fixtures) {
    try {
      report({ stage: "import", name: fixture.name });
      const response = await fetch(`${baseUrl}/${fixture.fileName}`);
      if (!response.ok) throw new Error(`Fixture response ${response.status}`);
      const book = await library.importBook({ fileName: fixture.fileName, data: await response.arrayBuffer() });
      for (const mode of ["scroll", "paginated-double"] as const) {
        saveReaderPreferences({ ...getReaderPreferences(), readingMode: mode,
          fixedLayoutReadingMode: mode, fontFamily: "curated:lxgw", fontSize: "x-large" });
        report({ stage: `open/${mode}`, name: fixture.name });
        const start = performance.now();
        await reader.openBook(book.id);
        // This suite measures ordinary reading; a separately tested navigator
        // may have its own durable resting position in this disposable profile.
        if (readingRuntime.snapshot().mode?.requestedActive) await reader.configureMode({ active: false });
        const first = await inspect(), firstMs = Math.round(performance.now() - start);
        const navigateStart = performance.now();
        const middleIndex = Math.floor(first.view.book!.sections.length / 2);
        // Repeated runs reuse imports. Progress intentionally retains the
        // furthest position, so don't request an earlier page than that record.
        const resumeCfi = fixture.resumeCfi ?? ((first.snapshot.pagination?.section.index ?? 0) >= middleIndex
          ? first.snapshot.location!.cfi : undefined);
        await reader.goTo({ bookId: book.id, contentVersion: first.snapshot.location!.contentVersion, ...(resumeCfi ? { cfi: resumeCfi }
          : { sectionIndex: middleIndex }) });
        const middle = await inspect(), navigateMs = Math.round(performance.now() - navigateStart);
        const index = middle.snapshot.pagination?.section.index;
        await reader.close();
        const resumeStart = performance.now();
        await reader.openBook(book.id);
        const resumed = await inspect(), resumeMs = Math.round(performance.now() - resumeStart);
        const restoredIndex = resumed.snapshot.pagination?.section.index;
        // A fixed-layout spread displays two source pages. Its reported side
        // can change on reopen while the saved page remains visibly present.
        const savedPageVisible = resumed.snapshot.pagination?.layout === "fixed"
          && resumed.snapshot.pagination.flow === "paginated"
          && resumed.view.renderer!.getContents().some(content => content.index === index && visibleDocument(content.doc));
        if (restoredIndex !== index && !savedPageVisible) throw new Error(`Reopen restored source ${restoredIndex}, expected ${index}`);
        const result: Measurement = { name: fixture.name, bytes: fixture.bytes, mode, firstMs, navigateMs,
          resumeMs, sections: resumed.view.book!.sections.length, retained: resumed.retained,
          visibleChars: resumed.snapshot.visibleText.length };
        results.push(result);
        report({ stage: "measured", result });
        await reader.step("next");
        await inspect();
        await reader.step("previous");
        await inspect();
        await reader.close();
      }
    } catch (error) {
      report({ stage: "failed", name: fixture.name, error: String(error) });
      await reader.close();
    }
  }
  return results;
}
