import { useEffect, useState, useSyncExternalStore } from "react";
import type { ZoomFeedback } from "../lib/zoom-feedback";

/** How long the percentage stays up after the zoom last changed. */
const INDICATOR_HOLD_MS = 900;

/**
 * The percentage a zoom indicator shows, and whether it is showing: up from
 * the moment the zoom changes, down once it has held still for a moment.
 */
export function useZoomIndicator(feedback: ZoomFeedback): { percent: number; visible: boolean } | null {
  const snapshot = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot);
  const [hiddenSerial, setHiddenSerial] = useState(0);
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(() => setHiddenSerial(snapshot.serial), INDICATOR_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot]);
  if (!snapshot) return null;
  return { percent: snapshot.percent, visible: snapshot.serial !== hiddenSerial };
}
