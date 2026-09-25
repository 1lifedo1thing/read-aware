import { useCallback, useState } from "react";

/**
 * Which of several collapsible contents to render, held through the collapse.
 *
 * A container that animates closed must keep painting what it held until the
 * animation ends; switching to nothing at once would collapse from an empty
 * box. `shown` follows `active` while something is active, keeps the last one
 * after it goes null, and lets go when the caller reports the collapse ended
 * (`settle`, from its transitionend). The container should be inert while
 * closed, so a collapse that never reports (reduced motion) leaves nothing
 * reachable behind.
 */
export function useRetainedWhileClosing<K extends string>(active: K | null): {
  shown: K | null;
  settle: () => void;
} {
  const [retained, setRetained] = useState<K | null>(active);
  // Adjusting state from the previous render during render (React's
  // documented pattern) keeps this effect-free: the switch lands in the same
  // commit as the change that caused it.
  if (active !== null && active !== retained) setRetained(active);
  const settle = useCallback(() => {
    if (active === null) setRetained(null);
  }, [active]);
  return { shown: active ?? retained, settle };
}
