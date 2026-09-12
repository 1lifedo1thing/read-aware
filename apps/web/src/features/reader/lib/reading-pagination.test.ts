import { expect, test } from "bun:test";
import { readingPagePosition, readingPagination } from "./reading-pagination";
import { SectionProgress } from "../../../../foliate-js/src/progress";
import { attachReadingEngine, createReadingEngineAdapter } from "./reading-engine-adapter";
import type { FoliateView } from "./foliate-engine";
import { readingRuntime } from "../../../domain/reading-runtime";

function fixture() {
  const view = Object.assign(new EventTarget(), {
    isFixedLayout: false,
    book: { sections: [{}, { linear: "no" }, {}, {}] },
    renderer: { scrolled: false, pages: 10, page: 3 },
    lastLocation: { section: { current: 1 }, cfi: "actual", fraction: 0.25, range: null },
  });
  return { view, read: () => readingPagination(view as unknown as FoliateView) };
}

test("fixed-layout page readouts use source pages rather than size-based engine locations", () => {
  const progress = new SectionProgress(Array.from({ length: 4 }, () => ({ size: 1000 })), 1500, 1600);
  for (let index = 0; index < 4; index++) {
    const detail = progress.getProgress(index, 0, 1);
    expect(readingPagePosition(true, detail)).toEqual({ current: index + 1, total: 4 });
    expect(readingPagePosition(false, detail)).toEqual({ current: Math.min(detail.location.total, detail.location.current + 1), total: detail.location.total });
  }
});

test("short reflowable books never display location zero, including the last visible section", () => {
  const progress = new SectionProgress([{ size: 180 }, { size: 75 }], 1500, 1600);
  for (const index of [0, 1]) {
    const detail = progress.getProgress(index, 0, 1);
    expect(detail.location).toEqual({ current: 0, next: 0, total: 1 });
    expect(readingPagePosition(false, detail)).toEqual({ current: 1, total: 1 });
  }
  const boundary = new SectionProgress([{ size: 3000 }], 1500, 1600);
  expect(readingPagePosition(false, boundary.getProgress(0, 1, 0))).toEqual({ current: 2, total: 2 });
  const empty = new SectionProgress([{ size: 0 }], 1500, 1600);
  expect(readingPagePosition(false, empty.getProgress(0))).toEqual({ current: 0, total: 0 });
});

test("reflow metrics count current-section viewports, excluding engine padding and not source sections", () => {
  const f = fixture();
  expect(f.read()).toEqual({ layout: "reflowable", flow: "paginated", section: { index: 1, count: 4 }, screen: { index: 2, count: 8 } });
  f.view.renderer.page = 1; expect(f.read()?.screen).toEqual({ index: 0, count: 8 });
  f.view.renderer.page = 8; expect(f.read()?.screen).toEqual({ index: 7, count: 8 });
  for (const page of [0, 9, -1, 10, NaN, Infinity, 1.5]) {
    f.view.renderer.page = page; expect(f.read()?.screen).toBeNull();
  }
  f.view.renderer.page = 1;
  for (const pages of [0, 1, 2, NaN, Infinity, 3.5]) {
    f.view.renderer.pages = pages; expect(f.read()?.screen).toBeNull();
  }
  f.view.renderer.pages = 3; expect(f.read()?.screen).toEqual({ index: 0, count: 1 });
});

test("fixed layout and continuous scroll expose source identity without fabricated screen counts", () => {
  const f = fixture();
  f.view.isFixedLayout = true;
  expect(f.read()).toEqual({ layout: "fixed", flow: "paginated", section: { index: 1, count: 4 }, screen: null });
  f.view.renderer.scrolled = true;
  expect(f.read()).toMatchObject({ layout: "fixed", flow: "scrolled", screen: null });
  f.view.isFixedLayout = false;
  expect(f.read()).toMatchObject({ layout: "reflowable", flow: "scrolled", screen: null });
  f.view.lastLocation.section.current = 4; expect(f.read()).toBeNull();
  f.view.lastLocation.section.current = -1; expect(f.read()).toBeNull();
  expect(readingPagination({ renderer: null } as unknown as FoliateView)).toBeNull();
});

test("real adapter wiring publishes layout-only relocations and rejects replaced engine events", () => {
  const f = fixture(), view = f.view as unknown as FoliateView;
  expect(createReadingEngineAdapter(view, "pagination-book", "v1").pagination?.()).toEqual(f.read());
  const session = readingRuntime.begin("pagination-book");
  const seen: number[] = [];
  const off = readingRuntime.observe(snapshot => { if (snapshot.pagination?.screen) seen.push(snapshot.pagination.screen.count); });
  const detach = attachReadingEngine(view, session, "pagination-book", "v1");
  let replacement: (() => void) | undefined;
  try {
    expect(readingRuntime.snapshot().pagination).toEqual(f.read());
    const revision = readingRuntime.snapshot().revision;
    f.view.renderer.pages = 6; f.view.renderer.page = 1;
    f.view.dispatchEvent(new Event("relocate"));
    expect(readingRuntime.snapshot().revision).toBeGreaterThan(revision);
    expect(readingRuntime.snapshot().pagination?.screen).toEqual({ index: 0, count: 4 });
    expect(seen.at(-1)).toBe(4);
    const second = fixture(); second.view.renderer.pages = 5;
    replacement = attachReadingEngine(second.view as unknown as FoliateView, session, "pagination-book", "v1");
    const replaced = readingRuntime.snapshot();
    f.view.dispatchEvent(new Event("relocate")); detach();
    expect(readingRuntime.snapshot()).toEqual(replaced);
    replacement(); expect(readingRuntime.snapshot().pagination).toBeNull();
    second.view.dispatchEvent(new Event("relocate")); expect(readingRuntime.snapshot().pagination).toBeNull();
  } finally { off(); detach(); replacement?.(); readingRuntime.closed(); }
});
