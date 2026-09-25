import { DISMISS_VELOCITY_PX_PER_MS } from "../../reader/lib/panel-swipe";

/**
 * Whether a released swipe leaves a row's action revealed. A flick decides by
 * its direction; otherwise the row goes to whichever rest it is nearer:
 * fully open (offset -width) or closed (0).
 */
export function settlesRevealed(offset: number, velocity: number, width: number): boolean {
  if (velocity <= -DISMISS_VELOCITY_PX_PER_MS) return true;
  if (velocity >= DISMISS_VELOCITY_PX_PER_MS) return false;
  return offset < -width / 2;
}

/** Where a drag that started from `base` puts the row: never past either rest. */
export function revealOffset(base: number, dx: number, width: number): number {
  return Math.min(0, Math.max(-width, base + dx));
}
