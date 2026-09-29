/**
 * The channel a fixed-layout zoom reports itself on, for the transient
 * indicator that shows the new percentage. A plain external store rather than
 * React state: a pinch changes the zoom at every step, and only the indicator
 * — not the reader around it — should render for each one.
 */
import { zoomPercent } from "./fixed-layout-zoom";

export type ZoomFeedbackSnapshot = {
  /** The zoom as a percentage of its fit. */
  percent: number;
  /** Bumped on every report, so a repeat of the same percent still re-shows it. */
  serial: number;
} | null;

export type ZoomFeedback = {
  publish: (factor: number) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ZoomFeedbackSnapshot;
};

export function createZoomFeedback(): ZoomFeedback {
  let snapshot: ZoomFeedbackSnapshot = null;
  const listeners = new Set<() => void>();
  return {
    publish: (factor) => {
      snapshot = { percent: zoomPercent(factor), serial: (snapshot?.serial ?? 0) + 1 };
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}
