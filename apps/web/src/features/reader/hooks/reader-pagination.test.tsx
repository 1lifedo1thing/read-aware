import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { FoliateView } from "../lib/foliate-engine";
import { useReaderPagination } from "./useReaderPagination";

type Pagination = ReturnType<typeof useReaderPagination>;

/** Mount the hook against `view` in a JSDOM window and run `body`. */
async function withPagination(
  view: FoliateView,
  body: (harness: { state: () => Pagination; viewRef: { current: FoliateView | null } }) => Promise<void>,
) {
  const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const viewRef: { current: FoliateView | null } = { current: view };
  let state!: Pagination;
  const options = { viewRef, readingModeRef: { current: "scroll" as const },
    shellVisibleRef: { current: false }, onContentScrollRef: { current: undefined },
    clearSelection: () => {}, onAdvancePastEnd: () => {} };
  function Harness() { state = useReaderPagination(options); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    await body({ state: () => state, viewRef });
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

/** A navigation that settles only when the test says so. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("chapter crossing suspends native scrolling before fading and resumes after success or failure", async () => {
  let suspended = false, pauses = 0, resumes = 0, stepped = 0;
  const view = { renderer: { suspendScroll: () => {
    suspended = true; pauses++;
    return () => { suspended = false; resumes++; };
  } }, next: async () => { stepped++; }, prev: async () => { stepped++; } } as unknown as FoliateView;
  await withPagination(view, async ({ state }) => {
    for (const fail of [false, true]) {
      await act(async () => {
        const navigation = state().crossTo(async () => {
          expect(suspended).toBe(true);
          if (fail) throw Error("Navigation failed");
        });
        expect(suspended).toBe(true); // Already locked during the outgoing fade.
        // A relative section step mid-crossing is the same push's momentum.
        await state().crossSection(1);
        await navigation;
      });
      expect(suspended).toBe(false);
      expect(state().isCrossing).toBe(false);
    }
    expect(stepped).toBe(0);
    expect(pauses).toBe(2);
    expect(resumes).toBe(2);
  });
});

test("a jump requested mid-crossing lands after it, latest wins, still behind the fade", async () => {
  const landed: string[] = [];
  let pauses = 0, suspended = false;
  const view = { renderer: { suspendScroll: () => {
    pauses++; suspended = true;
    return () => { suspended = false; };
  } } } as unknown as FoliateView;
  await withPagination(view, async ({ state }) => {
    const first = deferred();
    // The fade's scroll suspension spans the whole hidden phase, so a jump
    // that runs while it holds ran before the reveal.
    const observed: { hidden: boolean | null } = { hidden: null };
    let settled: Promise<void>[] = [];
    await act(async () => {
      settled.push(state().crossTo(async () => { landed.push("first"); await first.promise; }));
      // The fade has not even finished; the first jump has not started yet.
      settled.push(state().crossTo(() => { landed.push("superseded"); }));
      settled.push(state().crossTo(() => {
        landed.push("latest");
        observed.hidden = suspended;
      }));
      // Let the fade elapse so the first navigation is in flight, then queue more.
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(landed).toEqual(["first"]);
      settled.push(state().crossTo(() => { landed.push("also superseded"); }));
      settled.push(state().crossTo(() => {
        landed.push("newest");
        observed.hidden = suspended;
      }));
      first.resolve();
      await Promise.all(settled);
    });
    // Only the running jump and the newest request ran; nothing in between.
    expect(landed).toEqual(["first", "newest"]);
    expect(observed.hidden).toBe(true);
    expect(pauses).toBe(1); // one crossing: the queued jump rode the same fade
    expect(state().isCrossing).toBe(false);

    // Every caller's promise settles only once the view is at rest — a
    // superseded caller must not believe its jump is done while another runs.
    const second = deferred();
    let firstCallerDone = false;
    settled = [];
    await act(async () => {
      const early = state().crossTo(() => second.promise);
      void early.then(() => { firstCallerDone = true; });
      await new Promise(resolve => setTimeout(resolve, 200));
      const later = state().crossTo(() => { landed.push("after second"); });
      second.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(firstCallerDone).toBe(false);
      await Promise.all([early, later]);
    });
    expect(firstCallerDone).toBe(true);
    expect(landed.at(-1)).toBe("after second");
  });
});

test("a jump requested during the settle runs as its own crossing", async () => {
  const landed: string[] = [];
  let pauses = 0;
  const view = { renderer: { suspendScroll: () => { pauses++; return () => {}; } } } as unknown as FoliateView;
  await withPagination(view, async ({ state }) => {
    await act(async () => {
      const first = state().crossTo(() => { landed.push("first"); });
      // Past the fade (140ms) and into the settle (120ms more).
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(landed).toEqual(["first"]);
      const late = state().crossTo(() => { landed.push("late"); });
      await Promise.all([first, late]);
    });
    expect(landed).toEqual(["first", "late"]);
    expect(pauses).toBe(2);
    expect(state().isCrossing).toBe(false);
  });
});

test("a jump queued for a replaced engine is discarded; the new engine's jumps start fresh", async () => {
  const landed: string[] = [];
  const renderer = { suspendScroll: () => () => {} };
  const oldView = { renderer } as unknown as FoliateView;
  const newView = { renderer } as unknown as FoliateView;
  await withPagination(oldView, async ({ state, viewRef }) => {
    await act(async () => {
      const running = deferred();
      const first = state().crossTo(async () => { landed.push("old"); await running.promise; });
      await new Promise(resolve => setTimeout(resolve, 200));
      const stale = state().crossTo(() => { landed.push("stale"); });
      // The book is replaced while the old crossing is still navigating.
      viewRef.current = newView;
      state().resetCrossing();
      const fresh = state().crossTo(() => { landed.push("new"); });
      running.resolve();
      await Promise.all([first, stale, fresh]);
    });
    expect(landed).toEqual(["old", "new"]);
    expect(state().isCrossing).toBe(false);
  });
});
