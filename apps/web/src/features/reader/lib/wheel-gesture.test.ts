import { describe, expect, test } from "bun:test";
import { createWheelGesture } from "./wheel-gesture";

// A gesture spent panning a zoomed page must never also turn it; a new
// gesture at the page's edge does.
describe("claimed gestures", () => {
  test("heuristic mode: travel after a claim never steps until the gesture ends", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    for (let i = 0; i < 5; i++) gesture.claim(30, (t += 16));
    // The page reached its edge; the same swipe keeps pushing.
    for (let i = 0; i < 10; i++) expect(gesture.feed(30, (t += 16))).toBe(0);
    // A pause ends it; a new swipe at the edge turns.
    t += 400;
    expect(gesture.feed(30, (t += 16))).toBe(0);
    expect(gesture.feed(30, (t += 16))).toBe(1);
  });

  test("heuristic mode: a reversal after a claim is new input", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.claim(40, (t += 16));
    expect(gesture.feed(-40, (t += 16))).toBe(0);
    expect(gesture.feed(-40, (t += 16))).toBe(-1);
  });

  test("phase mode: a claimed drag stays spent through its momentum; the next touch can step", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.notifyPhase("touch");
    gesture.claim(50, (t += 16));
    expect(gesture.feed(80, (t += 16))).toBe(0);
    gesture.notifyPhase("momentum");
    for (let i = 0; i < 20; i++) expect(gesture.feed(40, (t += 16))).toBe(0);
    gesture.notifyPhase("end");
    gesture.notifyPhase("touch");
    expect(gesture.feed(70, (t += 16))).toBe(1);
  });

  test("an unclaimed gesture still steps once at the threshold", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    expect(gesture.feed(30, 16)).toBe(0);
    expect(gesture.feed(30, 32)).toBe(1);
    expect(gesture.feed(30, 48)).toBe(0);
  });
});
