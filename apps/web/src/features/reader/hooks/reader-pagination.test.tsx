import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { FoliateView } from "../lib/foliate-engine";
import { useReaderPagination } from "./useReaderPagination";

test("chapter crossing suspends native scrolling before fading and resumes after success or failure", async () => {
  const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let suspended = false, pauses = 0, resumes = 0;
  const view = { renderer: { suspendScroll: () => {
    suspended = true; pauses++;
    return () => { suspended = false; resumes++; };
  } } } as unknown as FoliateView;
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: ReturnType<typeof useReaderPagination>;
  const options = { viewRef: { current: view }, readingModeRef: { current: "scroll" as const },
    shellVisibleRef: { current: false }, onContentScrollRef: { current: undefined },
    clearSelection: () => {}, onAdvancePastEnd: () => {} };
  function Harness() { state = useReaderPagination(options); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    for (const fail of [false, true]) {
      await act(async () => {
        const navigation = state.crossTo(async () => {
          expect(suspended).toBe(true);
          if (fail) throw Error("Navigation failed");
        });
        expect(suspended).toBe(true); // Already locked during the outgoing fade.
        await state.crossTo(() => { throw Error("Duplicate crossing must not run"); });
        await navigation;
      });
      expect(suspended).toBe(false);
      expect(state.isCrossing).toBe(false);
    }
    expect(pauses).toBe(2);
    expect(resumes).toBe(2);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
