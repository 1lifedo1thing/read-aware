import { expect, test } from "bun:test";
import { revealOffset, settlesRevealed } from "./swipe-reveal";

test("a slow release rests at the nearer end", () => {
  expect(settlesRevealed(-50, 0, 80)).toBe(true);
  expect(settlesRevealed(-30, 0, 80)).toBe(false);
});

test("a flick decides by its direction, wherever it is let go", () => {
  expect(settlesRevealed(-10, -0.8, 80)).toBe(true);
  expect(settlesRevealed(-70, 0.8, 80)).toBe(false);
});

test("the row follows the finger between closed and fully open only", () => {
  expect(revealOffset(0, -30, 80)).toBe(-30);
  expect(revealOffset(0, -200, 80)).toBe(-80);
  expect(revealOffset(0, 40, 80)).toBe(0);
  // Dragging an open row back toward closed.
  expect(revealOffset(-80, 30, 80)).toBe(-50);
});
