import type { PageRegion } from "./book.js";

// READAWARE: where a zoomed PDF page gets its sharp overlay. The full-page
// raster is capped (see MAX_RENDER_PIXELS in pdf.ts), so past that budget the
// page is drawn once at a scale that fits and upscaled — soft exactly when a
// reader zoomed in to see detail. The overlay re-rasters just the part on
// screen at the true scale, grown by a margin so a small scroll stays inside
// what was drawn, and always within its own pixel budget.

/** Share of the visible region's own size added on each side. */
export const DETAIL_MARGIN = 0.5;

const area = (region: PageRegion, width: number, height: number) =>
  (region.right - region.left) * width * (region.bottom - region.top) * height;

const grow = (region: PageRegion, by: number): PageRegion => {
  const dx = (region.right - region.left) * by;
  const dy = (region.bottom - region.top) * by;
  return {
    left: Math.max(0, region.left - dx),
    top: Math.max(0, region.top - dy),
    right: Math.min(1, region.right + dx),
    bottom: Math.min(1, region.bottom + dy),
  };
};

/**
 * The region to draw for `visible` on a page `width` × `height` device
 * pixels at the target scale, holding at most `budget` pixels: the visible
 * part with as much of the margin as fits, or — on a screen larger than the
 * budget itself — the middle of the visible part.
 */
export function detailRegion(visible: PageRegion, width: number, height: number, budget: number): PageRegion {
  const grown = grow(visible, DETAIL_MARGIN);
  if (area(grown, width, height) <= budget) return grown;
  if (area(visible, width, height) > budget) {
    const shrink = Math.sqrt(budget / area(visible, width, height)) / 2;
    const cx = (visible.left + visible.right) / 2;
    const cy = (visible.top + visible.bottom) / 2;
    const hw = (visible.right - visible.left) * shrink;
    const hh = (visible.bottom - visible.top) * shrink;
    return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
  }
  // Some of the margin fits: the largest share that does. Area grows
  // monotonically with the margin, so bisection finds it.
  let fits = 0;
  let exceeds = DETAIL_MARGIN;
  for (let i = 0; i < 12; i++) {
    const mid = (fits + exceeds) / 2;
    if (area(grow(visible, mid), width, height) <= budget) fits = mid;
    else exceeds = mid;
  }
  return grow(visible, fits);
}

/** Whether `outer` covers all of `inner`. */
export const regionCovers = (outer: PageRegion, inner: PageRegion): boolean =>
  inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
