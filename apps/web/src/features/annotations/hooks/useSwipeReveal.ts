import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { lockSwipe, releaseVelocity, type SwipeLock } from "../../reader/lib/panel-swipe";
import { revealOffset, settlesRevealed } from "../lib/swipe-reveal";

type Gesture = {
  touchId: number;
  startX: number;
  startY: number;
  base: number;
  lock: SwipeLock;
  samples: { t: number; at: number }[];
};

/**
 * Swipe a list row left to reveal an action behind its right edge, as in iOS
 * Mail; swipe it back, or touch anywhere else, to close it. Touch only: a
 * mouse keeps whatever hover affordance the row has. The axis rules are the
 * reader panels' (lib/panel-swipe), so vertical movement stays the list's
 * scrolling and a surrounding pull-down drawer is left alone.
 */
export function useSwipeReveal<T extends HTMLElement>(ref: RefObject<T | null>, width: number): {
  /** How far the row is moved left, 0..-width. */
  offset: number;
  /** The finger holds the row (no settle transition). */
  dragging: boolean;
  close: () => void;
} {
  const [offset, setOffsetState] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Handlers read the latest offset, not the one from the render they closed over.
  const offsetRef = useRef(0);
  const setOffset = useCallback((next: number) => {
    offsetRef.current = next;
    setOffsetState(next);
  }, []);
  const close = useCallback(() => setOffset(0), [setOffset]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let gesture: Gesture | null = null;
    const touchOf = (event: TouchEvent, id: number) =>
      Array.from(event.changedTouches).find((touch) => touch.identifier === id)
      ?? Array.from(event.touches).find((touch) => touch.identifier === id);

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      gesture = { touchId: touch.identifier, startX: touch.clientX, startY: touch.clientY,
        base: offsetRef.current, lock: { kind: "pending" }, samples: [] };
    };
    const onMove = (event: TouchEvent) => {
      const current = gesture;
      if (!current) return;
      const touch = touchOf(event, current.touchId);
      if (!touch) return;
      const dx = touch.clientX - current.startX;
      if (current.lock.kind === "pending") {
        // A closed row opens leftward; an open one closes rightward.
        const lock = lockSwipe(dx, touch.clientY - current.startY, current.base < 0 ? "right" : "left", false);
        if (lock.kind === "pending") return;
        if (lock.kind !== "drag") {
          gesture = null;
          return;
        }
        current.lock = lock;
        setDragging(true);
      }
      event.preventDefault();
      current.samples.push({ t: event.timeStamp, at: touch.clientX });
      setOffset(revealOffset(current.base, dx, width));
    };
    const onEnd = (event: TouchEvent) => {
      const current = gesture;
      if (!current || !touchOf(event, current.touchId)) return;
      gesture = null;
      if (current.lock.kind !== "drag") return;
      setDragging(false);
      const open = event.type === "touchend"
        && settlesRevealed(offsetRef.current, releaseVelocity(current.samples), width);
      setOffset(open ? -width : 0);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, setOffset, width]);

  // An open row closes when the next touch lands anywhere else. Within the
  // same list (the nearest `[data-swipe-reveal-scope]`), that touch does only
  // this, as in iOS: tapping another row closes the open one instead of also
  // opening what was tapped. Touches outside the list go through untouched.
  const open = offset !== 0 && !dragging;
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const row = ref.current;
      if (!row || (target && row.contains(target))) return;
      close();
      const scope = row.closest("[data-swipe-reveal-scope]");
      if (!target || !scope?.contains(target)) return;
      // Swallow the click this press ends in; a press that becomes a scroll
      // ends in pointercancel and no click, so stand down then instead.
      const stop = () => {
        document.removeEventListener("click", swallow, true);
        document.removeEventListener("pointercancel", stop, true);
      };
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
        stop();
      };
      document.addEventListener("click", swallow, true);
      document.addEventListener("pointercancel", stop, true);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, ref, close]);

  return { offset, dragging, close };
}
