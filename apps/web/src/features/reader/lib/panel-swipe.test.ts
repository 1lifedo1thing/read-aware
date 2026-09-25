import { expect, test } from "bun:test";
import {
  AXIS_LOCK_SLOP_PX,
  lockSwipe,
  releaseVelocity,
  shouldDismiss,
  swipeOffset,
} from "./panel-swipe";

test("a touch commits to an axis only after the slop", () => {
  expect(lockSwipe(AXIS_LOCK_SLOP_PX - 1, 0, "left", false)).toEqual({ kind: "pending" });
  expect(lockSwipe(0, AXIS_LOCK_SLOP_PX, "left", false)).toEqual({ kind: "release" });
  // Diagonal ties go to vertical scrolling.
  expect(lockSwipe(10, 10, "right", false)).toEqual({ kind: "release" });
});

test("a sheet drags only toward the side it leaves by", () => {
  expect(lockSwipe(-12, 2, "left", false)).toEqual({ kind: "drag", direction: -1 });
  expect(lockSwipe(12, 2, "left", false)).toEqual({ kind: "release" });
  expect(lockSwipe(12, 2, "right", false)).toEqual({ kind: "drag", direction: 1 });
  expect(lockSwipe(-12, 2, "right", false)).toEqual({ kind: "release" });
});

test("a rightward swipe from the left edge is the back gesture for either sheet", () => {
  expect(lockSwipe(12, 2, "left", true)).toEqual({ kind: "edge-back", direction: 1 });
  expect(lockSwipe(12, 2, "right", true)).toEqual({ kind: "edge-back", direction: 1 });
  // Moving left from the edge is an ordinary drag decision.
  expect(lockSwipe(-12, 2, "left", true)).toEqual({ kind: "drag", direction: -1 });
});

test("the drawer drags only downward, and sideways movement is left alone", () => {
  expect(lockSwipe(2, 12, "down", false)).toEqual({ kind: "drag", direction: 1 });
  expect(lockSwipe(2, -12, "down", false)).toEqual({ kind: "release" });
  expect(lockSwipe(12, 2, "down", false)).toEqual({ kind: "release" });
  // The left-edge back swipe belongs to the side sheets only.
  expect(lockSwipe(12, 2, "down", true)).toEqual({ kind: "release" });
});

test("the sheet follows the finger toward its exit but never past its rest position", () => {
  expect(swipeOffset(40, 1)).toBe(40);
  expect(swipeOffset(-40, 1)).toBe(0);
  expect(swipeOffset(-40, -1)).toBe(-40);
  expect(swipeOffset(40, -1)).toBe(0);
});

test("release velocity uses only the recent window", () => {
  expect(releaseVelocity([])).toBe(0);
  expect(releaseVelocity([{ t: 0, at: 0 }])).toBe(0);
  // Only the samples within 80 ms of the last one count: (70 - 10) / 80.
  expect(releaseVelocity([{ t: 0, at: 0 }, { t: 200, at: 10 }, { t: 240, at: 30 }, { t: 280, at: 70 }])).toBe(0.75);
});

test("a release dismisses past a share of the width or on a flick, in the travel direction only", () => {
  const width = 400;
  expect(shouldDismiss(121, 0, width, 1)).toBe(true);
  expect(shouldDismiss(119, 0, width, 1)).toBe(false);
  expect(shouldDismiss(30, 0.5, width, 1)).toBe(true);
  expect(shouldDismiss(20, 0.5, width, 1)).toBe(false);
  // A flick back toward the rest position settles the sheet even when far out.
  expect(shouldDismiss(100, -0.8, width, 1)).toBe(false);
  expect(shouldDismiss(-150, -0.1, width, -1)).toBe(true);
});
