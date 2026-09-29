import { useEffect, useState, useSyncExternalStore } from "react";
import type { ZoomFeedback } from "../lib/zoom-feedback";

/** How long the percentage stays up after the zoom last changed. */
const INDICATOR_HOLD_MS = 900;

export type ZoomIndicatorState = {
  percent: number;
  /** Showing: the zoom just changed, or it is off the fit while the reader controls are up. */
  visible: boolean;
  /** The zoom is off the fit, so there is something to reset. */
  resettable: boolean;
};

/**
 * What the zoom indicator shows. It comes up whenever the zoom changes and
 * goes once the zoom has held still for a moment; while the reader controls
 * are showing, a zoom off the fit stays up with them, offering its reset.
 */
export function useZoomIndicator(feedback: ZoomFeedback, controlsVisible: boolean): ZoomIndicatorState | null {
  const snapshot = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot);
  const [hiddenSerial, setHiddenSerial] = useState(0);
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(() => setHiddenSerial(snapshot.serial), INDICATOR_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot]);
  if (!snapshot) return null;
  const resettable = snapshot.percent !== 100;
  return {
    percent: snapshot.percent,
    visible: snapshot.serial !== hiddenSerial || (controlsVisible && resettable),
    resettable,
  };
}
