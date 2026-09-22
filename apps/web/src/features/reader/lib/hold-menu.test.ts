import { describe, expect, test } from "bun:test";
import { holdMenuItemAt, pointInReaderRoot, resolveHoldRelease } from "./hold-menu";

const rects = [
  { left: 100, top: 200, width: 36, height: 36 },
  { left: 138, top: 200, width: 36, height: 36 },
  { left: 176, top: 200, width: 36, height: 36 },
];

describe("resolveHoldRelease", () => {
  test("lifting on an action runs it however far the finger went", () => {
    expect(resolveHoldRelease({ hovered: 2, travelled: 0 })).toEqual({ kind: "run", index: 2 });
    expect(resolveHoldRelease({ hovered: 0, travelled: 120 })).toEqual({ kind: "run", index: 0 });
  });
  test("lifting in place keeps the menu open for taps; lifting elsewhere after a slide dismisses it", () => {
    expect(resolveHoldRelease({ hovered: null, travelled: 6 })).toEqual({ kind: "stay" });
    expect(resolveHoldRelease({ hovered: null, travelled: 10 })).toEqual({ kind: "stay" });
    expect(resolveHoldRelease({ hovered: null, travelled: 11 })).toEqual({ kind: "close" });
  });
});

describe("holdMenuItemAt", () => {
  test("finds the action under the finger, with forgiving edges, and none in the gutter", () => {
    expect(holdMenuItemAt({ x: 118, y: 218 }, rects)).toBe(0);
    expect(holdMenuItemAt({ x: 139, y: 198 }, rects)).toBe(1);
    // Two pixels above the padded edge.
    expect(holdMenuItemAt({ x: 118, y: 194 }, rects)).toBeNull();
    expect(holdMenuItemAt({ x: 300, y: 218 }, rects)).toBeNull();
  });
  test("the gap between neighbours belongs to the later one, as painted", () => {
    expect(holdMenuItemAt({ x: 137, y: 218 }, rects)).toBe(1);
  });
});

describe("pointInReaderRoot", () => {
  test("offsets by the frame and root and applies the frame scale", () => {
    const frame = { left: 20, top: 100, width: 400, height: 800 }, root = { left: 20, top: 40, width: 400, height: 900 };
    expect(pointInReaderRoot({ x: 50, y: 30 }, frame, root)).toEqual({ x: 50, y: 90 });
    expect(pointInReaderRoot({ x: 50, y: 30 }, frame, root, 0.5)).toEqual({ x: 25, y: 75 });
  });
});
