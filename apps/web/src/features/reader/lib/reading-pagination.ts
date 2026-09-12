import type { ReadingPaginationSnapshot } from "@read-aware/core";
import type { FoliateRelocateDetail, FoliateView } from "./foliate-engine";

/** Fixed-layout source sections are pages; engine locations estimate text size. */
export function readingPagePosition(fixedLayout: boolean, detail: Pick<FoliateRelocateDetail, "section" | "location">): { current: number; total: number } {
  if (fixedLayout) return { current: detail.section.current + 1, total: detail.section.total };
  return { current: detail.location.current, total: detail.location.total };
}

/** Read the renderer's current geometry, never estimate unrendered sections. */
export function readingPagination(view: FoliateView): ReadingPaginationSnapshot | null {
  const renderer = view.renderer, index = view.lastLocation?.section.current, count = view.book?.sections.length;
  if (!renderer || index === undefined || count === undefined || !Number.isSafeInteger(index)
    || !Number.isSafeInteger(count) || count < 1 || index < 0 || index >= count) return null;
  const layout = view.isFixedLayout ? "fixed" : "reflowable";
  const flow = renderer.scrolled ? "scrolled" : "paginated";
  let screen: ReadingPaginationSnapshot["screen"] = null;
  if (layout === "reflowable" && flow === "paginated" && "pages" in renderer && "page" in renderer) {
    // Foliate's paginator has one leading and one trailing navigation pad.
    // A viewport may contain multiple columns; it is still one screen step.
    const pages = renderer.pages, page = renderer.page;
    if (Number.isSafeInteger(pages) && Number.isSafeInteger(page) && pages > 2 && page >= 1 && page < pages - 1) {
      screen = { index: page - 1, count: pages - 2 };
    }
  }
  return { layout, flow, section: { index, count }, screen };
}
