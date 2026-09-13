import { AppError, type ReadingLocation } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { loadContentNavigation, type FoliateView } from "./foliate-engine";
import type { ReadingEngineAdapter } from "../../../domain/reading-session-controller";
import { adjacentTocEntry, flattenToc } from "./epub-utils";
import { readingPagination } from "./reading-pagination";
import { readingVisibleText } from "./reading-visible-text";
import { readingRenderActor, readingRenderContext } from "./reading-render-context";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";

export async function waitForReadingPaint(view: FoliateView): Promise<void> {
  const renderer = view.renderer;
  if (renderer && "waitForCurrentRender" in renderer) {
    try { await renderer.waitForCurrentRender(); }
    catch (error) { throw new AppError("reader/render-failed", "Reader page could not finish rendering", { cause: error }); }
  }
}

function currentLocation(view: FoliateView, bookId: string, contentVersion: string): ReadingLocation {
  const position = view.lastLocation;
  if (!position) throw new AppError("reader/unavailable", "Renderer has not reported its first position");
  return {
    bookId, contentVersion,
    ...(position.cfi ? { cfi: position.cfi } : {}),
    ...(position.tocItem?.href ? { href: position.tocItem.href } : {}),
    ...(Number.isFinite(position.fraction) ? { fraction: position.fraction } : {}),
  };
}

/** The only renderer-specific part of the public reading-session controller. */
export function createReadingEngineAdapter(view: FoliateView, bookId: string, contentVersion: string, sourceRevision = contentVersion): ReadingEngineAdapter {
  const location = () => currentLocation(view, bookId, contentVersion);
  return {
    sourceRevision,
    pagination: () => readingPagination(view),
    navigate: async (target, origin = "system") => {
      const context = readingRenderContext(origin);
      if (target.sectionIndex !== undefined && !view.book?.sections[target.sectionIndex]) {
        throw new AppError("reader/target-not-found", "Source section does not exist");
      }
      const resolved = await view.goTo(target.sectionIndex ?? target.cfi ?? target.href ?? { fraction: target.fraction! }, context).catch((error: unknown) => {
        if (error && typeof error === "object" && "name" in error && error.name === "ContentRangeError") {
          throw new AppError("reader/target-not-found", "Stored source location no longer resolves", { cause: error });
        }
        throw error;
      });
      if (!resolved) throw new AppError("reader/target-not-found", "Renderer could not resolve this target");
      await waitForReadingPaint(view);
      if (target.textQuote) {
        const content = view.renderer?.getContents().find(content => content.index === resolved.index);
        if (!content) throw new AppError("reader/target-not-found", "Target page has no rendered text");
        const { resolveTextQuote } = await loadContentNavigation();
        let range: Range;
        try { range = resolveTextQuote(content.doc, target.textQuote); }
        catch (error) { throw new AppError("reader/target-not-found", "Search text could not be uniquely resolved", { cause: error }); }
        if (!await view.goTo(view.getCFI(resolved.index, range), context)) throw new AppError("reader/target-not-found", "Search text no longer resolves");
      }
      return location();
    },
    step: async (direction, origin = "system") => {
      const context = readingRenderContext(origin);
      if (direction === "next") await view.next(undefined, context);
      else if (direction === "previous") await view.prev(undefined, context);
      else if (direction === "next-chapter" || direction === "previous-chapter") {
        const entry = adjacentTocEntry(flattenToc(view.book?.toc ?? []), view.lastLocation?.tocItem?.href ?? null,
          direction === "next-chapter" ? 1 : -1);
        if (!entry) return location();
        if (!await view.goTo(entry.href, context)) throw new AppError("reader/target-not-found", "Adjacent TOC chapter could not be resolved");
      }
      else if (direction === "start" || direction === "end") {
        if (!await view.goTo({ fraction: direction === "start" ? 0 : 1 }, context)) throw new AppError("reader/target-not-found", "Book boundary could not be resolved");
      } else {
        const sections = view.book?.sections, current = view.lastLocation?.section.current;
        if (!sections || current === undefined || !sections[current]) throw new AppError("reader/unavailable", "Current source section is unavailable");
        const delta = direction === "next-section" ? 1 : -1;
        let index = current + delta;
        while (index >= 0 && index < sections.length && sections[index]?.linear === "no") index += delta;
        // At a book boundary keep the actual position, rather than fabricating movement.
        if (index < 0 || index >= sections.length) return location();
        if (!await view.goTo(index, context)) throw new AppError("reader/target-not-found", "Adjacent source section could not be resolved");
      }
      await waitForReadingPaint(view);
      return location();
    },
  };
}

export function attachReadingEngine(view: FoliateView, sessionId: string, bookId: string, contentVersion: string, sourceRevision = contentVersion, source?: DomainActor): (origin?: DomainActor) => void {
  if (readingRuntime.snapshot().sessionId !== sessionId) return () => {};
  const openingActor = causalActor(source ?? readingRuntime.openingActor(sessionId));
  const location = () => currentLocation(view, bookId, contentVersion);
  const engine = createReadingEngineAdapter(view, bookId, contentVersion, sourceRevision);
  const publish = (event?: Event) => {
    const visible = readingVisibleText(view);
    const origin = event ? readingRenderActor((event as CustomEvent<object>).detail) : openingActor;
    readingRuntime.relocate(sessionId, location(), visible.text, engine, visible.state, origin);
  };
  const detach = readingRuntime.attach(sessionId, engine, location(), openingActor);
  view.addEventListener("relocate", publish);
  publish();
  return origin => { view.removeEventListener("relocate", publish); detach(origin); };
}
