import { describe, expect, test } from "bun:test";
import { ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN, stepZoomFactor, wheelZoomRatio } from "./fixed-layout-zoom";

describe("zoom steps", () => {
  test("step along the ladder, and from between steps to the nearest one that way", () => {
    expect(stepZoomFactor(1, 1)).toBe(1.1);
    expect(stepZoomFactor(1, -1)).toBe(0.9);
    expect(stepZoomFactor(1.3, 1)).toBe(1.5);
    expect(stepZoomFactor(1.3, -1)).toBe(1.25);
    // A hair off a step counts as on it.
    expect(stepZoomFactor(1.249, 1)).toBe(1.5);
  });

  test("stop at the ends of the range", () => {
    expect(stepZoomFactor(ZOOM_FACTOR_MAX, 1)).toBe(ZOOM_FACTOR_MAX);
    expect(stepZoomFactor(ZOOM_FACTOR_MIN, -1)).toBe(ZOOM_FACTOR_MIN);
  });
});

describe("ctrl+wheel", () => {
  test("inverts Chromium's pinch deltas exactly", () => {
    // Chromium reports a pinch to scale s as deltaY = -100·ln(s).
    expect(wheelZoomRatio(-100 * Math.log(1.1), 0)).toBeCloseTo(1.1, 10);
    expect(wheelZoomRatio(-100 * Math.log(0.9), 0)).toBeCloseTo(0.9, 10);
  });

  test("turns a mouse-wheel notch into one bounded step, either way", () => {
    const zoomIn = wheelZoomRatio(-100, 0);
    const zoomOut = wheelZoomRatio(100, 0);
    expect(zoomIn).toBeGreaterThan(1.1);
    expect(zoomIn).toBeLessThan(1.3);
    expect(zoomIn * zoomOut).toBeCloseTo(1, 10);
    // Line- and page-mode deltas are converted before the same cap.
    expect(wheelZoomRatio(-3, 1)).toBe(zoomIn);
  });
});
