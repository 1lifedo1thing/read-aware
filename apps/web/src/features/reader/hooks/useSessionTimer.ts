import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The floating session timer pauses sooner than the aggregate reading stats. */
export const SESSION_TIMER_IDLE_MS = 60_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Session-only active reading time. Pauses retain the total; mode re-entry resets it.
 * The reader forwards iframe activity through activityRef, just as it does for
 * reading statistics, because those events never reach the outer window. */
export function useSessionTimer(
  enabled: boolean,
  activityRef?: RefObject<(() => void) | null>,
) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [showClock, setShowClock] = useState(false);
  const refreshRef = useRef<(() => void) | null>(null);
  const toggleClock = useCallback(() => {
    refreshRef.current?.();
    setShowClock(value => !value);
  }, []);

  useEffect(() => {
    setElapsedSeconds(0);
    setShowClock(false);
    if (!enabled) return;

    let elapsedMs = 0;
    let lastTickAt = performance.now();
    let lastActivityAt = lastTickAt;
    const isForeground = () => document.visibilityState === "visible" && document.hasFocus();
    let foreground = isForeground();
    const sample = () => {
      const tickAt = performance.now();
      // A suspended webview can miss ticks even without a visibility event.
      // Never turn that unobserved sleep interval into reading time.
      if (foreground && tickAt - lastTickAt <= 2_000) {
        elapsedMs += Math.max(0, Math.min(tickAt, lastActivityAt + SESSION_TIMER_IDLE_MS) - lastTickAt);
      }
      lastTickAt = tickAt;
      setElapsedSeconds(Math.floor(elapsedMs / 1000));
    };
    const onActivity = () => {
      sample();
      foreground = isForeground();
      if (foreground) lastActivityAt = performance.now();
    };
    const onForegroundChange = () => {
      sample();
      const next = isForeground();
      if (next && !foreground) lastActivityAt = performance.now();
      foreground = next;
      setNow(new Date());
    };
    onForegroundChange();
    refreshRef.current = onForegroundChange;
    if (activityRef) activityRef.current = onActivity;
    const timer = window.setInterval(onForegroundChange, 1000);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("focus", onForegroundChange);
    window.addEventListener("blur", onForegroundChange);
    document.addEventListener("visibilitychange", onForegroundChange);
    return () => {
      window.clearInterval(timer);
      refreshRef.current = null;
      if (activityRef?.current === onActivity) activityRef.current = null;
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onForegroundChange);
      window.removeEventListener("blur", onForegroundChange);
      document.removeEventListener("visibilitychange", onForegroundChange);
    };
  }, [enabled, activityRef]);

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const elapsed = hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
  return { elapsed: enabled ? elapsed : null, now, showClock, toggleClock };
}
