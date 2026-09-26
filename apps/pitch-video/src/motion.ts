import { Easing, interpolate } from "remotion";

/** The app's own --ra-ease-out-quint, so motion in the film matches the product. */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.55, 0, 1, 0.45);

/** 0→1 progress of an eased segment that starts at `start` and lasts `duration` frames. */
export function progress(
  frame: number,
  start: number,
  duration: number,
  easing: (t: number) => number = easeOut,
) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/** Linear map with clamping on both ends. */
export function map(frame: number, input: [number, number], output: [number, number]) {
  return interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** Opacity + rise + un-blur for a line of type arriving on screen. */
export function arrive(p: number, distance = 18, blur = 8) {
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * distance}px)`,
    filter: p < 1 ? `blur(${(1 - p) * blur}px)` : undefined,
  } as const;
}

/** Number of characters of `text` revealed after `frame`, at `rate` chars per frame. */
export function typed(text: string, frame: number, start: number, rate: number) {
  return text.slice(0, Math.max(0, Math.floor((frame - start) * rate)));
}
