/**
 * Zoom input for fixed-layout books (PDF, comics): the steps a key or button
 * moves through and the continuous factor a pinch or ctrl+wheel produces. The
 * model itself — a fit and a factor over it — is the engine's
 * (`foliate-js/src/fixed-zoom.ts`), imported directly because it is pure; the
 * per-book memory of it is `domain/reading-zoom.ts`.
 */
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  clampZoomFactor,
  normalizeFixedLayoutZoom,
  resolveFixedLayoutFit,
  sameFixedLayoutZoom,
  type FixedLayoutFit,
  type FixedLayoutZoom,
} from "../../../../foliate-js/src/fixed-zoom";
import type { TFunction } from "i18next";

export {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  clampZoomFactor,
  normalizeFixedLayoutZoom,
  resolveFixedLayoutFit,
  sameFixedLayoutZoom,
  type FixedLayoutFit,
  type FixedLayoutZoom,
};

/** The factors a zoom-in/out step lands on — the familiar viewer ladder. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6] as const;

/**
 * The next step past `factor` in `direction`. A factor between steps (left by
 * a pinch) moves to the nearest step that way rather than a whole step on.
 */
export function stepZoomFactor(factor: number, direction: 1 | -1): number {
  // Tolerance, so a factor a hair off a step still counts as on it.
  const epsilon = 0.005;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > factor + epsilon) ?? ZOOM_FACTOR_MAX;
  return ZOOM_STEPS.findLast((step) => step < factor - epsilon) ?? ZOOM_FACTOR_MIN;
}

/**
 * A continuous zoom lands on exactly 100% when released within this of it:
 * "back to fit" is the one factor a reader aims for by hand, and 98% is
 * never what they meant.
 */
const SNAP_TO_FIT = 0.04;

/** Clamp a continuous factor, snapping to the fit when it lands close to it. */
export function settleZoomFactor(factor: number): number {
  const clamped = clampZoomFactor(factor);
  return Math.abs(clamped - 1) <= SNAP_TO_FIT ? 1 : clamped;
}

/**
 * The factor a ctrl+wheel event scales by. Chromium reports a trackpad pinch
 * as ctrl+wheel with `deltaY = -100·ln(scale)`, which this inverts exactly;
 * a mouse wheel turned with the zoom chord held reports ~100 a notch, which
 * the per-event cap turns into a step of about 18%.
 */
const WHEEL_ZOOM_EVENT_CAP = 20;
export function wheelZoomRatio(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-WHEEL_ZOOM_EVENT_CAP, Math.min(WHEEL_ZOOM_EVENT_CAP, pixels)) / 100);
}

/** The label a zoom shows: its factor as a percentage of the fit. */
export const zoomPercent = (factor: number): number => Math.round(factor * 100);

/** What a page's 100% can fit to — its width, or the whole page. */
export function pageFitOptions(t: TFunction<"reader">): { value: Exclude<FixedLayoutFit, "auto">; label: string }[] {
  return (["width", "page"] as const).map((value) => ({ value, label: t(`pageFitOption.${value}`) }));
}
