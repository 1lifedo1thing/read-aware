/**
 * The touch reader's hold menu (a marking menu): in text-unit mode a finger
 * held on the page opens the resting unit's actions around the touch point.
 * Sliding onto an action and lifting runs it; lifting without having moved
 * leaves the menu open as an ordinary tap menu; lifting elsewhere after a
 * slide dismisses it. These are the gesture's pure rules and geometry; the
 * hook owns the pointer stream and the component draws the menu.
 */

/** A press this long, without travelling, opens the menu (the shelf's
 *  long-press menu uses the same delay). */
export const HOLD_MENU_PRESS_MS = 450;
/** A finger that travels further than this before the menu opens is scrolling
 *  or swiping, not holding; after the menu opens the same distance separates
 *  "lifted in place" from "slid". */
export const HOLD_MENU_MOVE_TOLERANCE_PX = 10;
/** Actions accept a slightly larger area than they draw: a thumb sliding along
 *  a row of icons rarely stops dead centre. */
export const HOLD_MENU_HIT_PADDING_PX = 4;

export type HoldMenuPoint = { x: number; y: number };
export type HoldMenuRect = { left: number; top: number; width: number; height: number };

export type HoldMenuRelease =
  | { kind: "run"; index: number }
  | { kind: "stay" }
  | { kind: "close" };

/** What lifting the finger means, given where it rests and how far it went. */
export function resolveHoldRelease(input: {
  hovered: number | null;
  travelled: number;
  tolerance?: number;
}): HoldMenuRelease {
  if (input.hovered != null) return { kind: "run", index: input.hovered };
  return input.travelled <= (input.tolerance ?? HOLD_MENU_MOVE_TOLERANCE_PX) ? { kind: "stay" } : { kind: "close" };
}

/** The action under a point, or null. Later actions win an overlap, matching
 *  paint order. */
export function holdMenuItemAt(point: HoldMenuPoint, rects: readonly HoldMenuRect[],
  padding = HOLD_MENU_HIT_PADDING_PX): number | null {
  for (let index = rects.length - 1; index >= 0; index--) {
    const rect = rects[index]!;
    if (point.x >= rect.left - padding && point.x <= rect.left + rect.width + padding
      && point.y >= rect.top - padding && point.y <= rect.top + rect.height + padding) return index;
  }
  return null;
}

/** Map a point in a section document's client space to the reader root's
 *  space; the section iframe may be scaled by the layout. */
export function pointInReaderRoot(point: HoldMenuPoint, frameRect: HoldMenuRect, rootRect: HoldMenuRect,
  scale = 1): HoldMenuPoint {
  return { x: frameRect.left + point.x * scale - rootRect.left, y: frameRect.top + point.y * scale - rootRect.top };
}

export const distanceBetween = (a: HoldMenuPoint, b: HoldMenuPoint) => Math.hypot(a.x - b.x, a.y - b.y);
