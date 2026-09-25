/**
 * Gesture decisions for dismissing a phone reader panel by swiping.
 *
 * Side sheets close by either of two gestures:
 * - the iOS back swipe: a touch that starts at the screen's left edge and
 *   moves right, whichever side the sheet came from;
 * - a drag anywhere on the sheet toward the side it slides out to (the
 *   contents sheet leaves to the left, the chat sheet to the right).
 * The bottom bar's drawer closes by a drag downward.
 *
 * The panel follows the finger and, on release, either leaves or settles
 * back. Movement across the exit axis belongs to the panel's own scrolling,
 * so a gesture commits to an axis once it has moved past a small slop.
 */

/** A touch starting this close to the screen's left edge is a back swipe. */
export const EDGE_BACK_ZONE_PX = 24;
/** Movement before a touch commits to an axis. */
export const AXIS_LOCK_SLOP_PX = 8;
/** Released past this share of the panel's extent, the panel leaves. */
export const DISMISS_DISTANCE_RATIO = 0.3;
/** A flick this fast (px/ms) toward the exit leaves regardless of distance… */
export const DISMISS_VELOCITY_PX_PER_MS = 0.4;
/** …once it has travelled at least this far. */
export const DISMISS_MIN_TRAVEL_PX = 24;
/** Only this recent movement counts toward the release velocity. */
export const VELOCITY_WINDOW_MS = 80;

export type SwipeExit = "left" | "right" | "down";
/** Along the exit axis: +1 travels right (or down); -1 travels left. */
export type SwipeDirection = 1 | -1;
export type SwipeLock =
  | { kind: "pending" }
  | { kind: "release" }
  | { kind: "edge-back"; direction: 1 }
  | { kind: "drag"; direction: SwipeDirection };

/**
 * Decide what a touch that has moved (dx, dy) since it started is doing.
 * `startedAtEdge` (the left screen edge) matters only to side sheets.
 */
export function lockSwipe(dx: number, dy: number, exit: SwipeExit, startedAtEdge: boolean): SwipeLock {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_SLOP_PX) return { kind: "pending" };
  if (exit === "down") {
    // Ties go to the cross axis here too, which holds nothing to scroll.
    if (Math.abs(dx) >= Math.abs(dy)) return { kind: "release" };
    return dy > 0 ? { kind: "drag", direction: 1 } : { kind: "release" };
  }
  if (Math.abs(dy) >= Math.abs(dx)) return { kind: "release" };
  if (startedAtEdge && dx > 0) return { kind: "edge-back", direction: 1 };
  const direction: SwipeDirection = exit === "left" ? -1 : 1;
  return Math.sign(dx) === direction ? { kind: "drag", direction } : { kind: "release" };
}

/** How far the panel follows the finger: toward its exit only, never past its rest. */
export function swipeOffset(delta: number, direction: SwipeDirection): number {
  return direction > 0 ? Math.max(0, delta) : Math.min(0, delta);
}

/** Release velocity (px/ms) along the exit axis over the recent samples, oldest first. */
export function releaseVelocity(samples: ReadonlyArray<{ t: number; at: number }>): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.at - first.at) / elapsed : 0;
}

/** Whether a release at this offset and velocity sends a panel of this extent away. */
export function shouldDismiss(offset: number, velocity: number, extent: number, direction: SwipeDirection): boolean {
  const travel = offset * direction;
  const speed = velocity * direction;
  return travel > extent * DISMISS_DISTANCE_RATIO
    || (travel > DISMISS_MIN_TRAVEL_PX && speed > DISMISS_VELOCITY_PX_PER_MS);
}
