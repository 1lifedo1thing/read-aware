import type { ReactNode } from "react";
import { mix } from "../motion";

/**
 * The app window is laid out at the product's own logical size — the same
 * pixel values as apps/web (14 px chrome text, 48 px header, 16 px icons) —
 * and the camera scales it onto the 1080p frame. Every window scene shares
 * the rest shot, so dissolves between them line up exactly.
 */
export const WINDOW = { w: 1100, h: 700 } as const;
/** Logical-to-frame scale at rest. */
export const BASE_SCALE = 1.25;
/** Where the window's centre sits on the frame at rest. */
const REST_CENTER = { x: 960, y: 190 + (WINDOW.h * BASE_SCALE) / 2 };

/**
 * A camera shot: the logical point (fx, fy) in the window lands on frame
 * point (ax, ay), at `scale` times the rest scale. Blending the numbers keeps
 * every move continuous.
 */
export type Shot = { scale: number; fx: number; fy: number; ax: number; ay: number };

export const REST_SHOT: Shot = {
  scale: 1,
  fx: WINDOW.w / 2,
  fy: WINDOW.h / 2,
  ax: REST_CENTER.x,
  ay: REST_CENTER.y,
};

export const blendShot = (a: Shot, b: Shot, p: number): Shot => ({
  scale: mix(a.scale, b.scale, p),
  fx: mix(a.fx, b.fx, p),
  fy: mix(a.fy, b.fy, p),
  ax: mix(a.ax, b.ax, p),
  ay: mix(a.ay, b.ay, p),
});

/** A shot that keeps the rest framing but leans in by `scale` around a logical point. */
export function leanShot(scale: number, fx: number, fy: number): Shot {
  const k = BASE_SCALE;
  return {
    scale,
    fx,
    fy,
    ax: REST_CENTER.x + (fx - WINDOW.w / 2) * k,
    ay: REST_CENTER.y + (fy - WINDOW.h / 2) * k,
  };
}

export function Camera({ shot, children }: { shot: Shot; children: ReactNode }) {
  const k = shot.scale * BASE_SCALE;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WINDOW.w,
        height: WINDOW.h,
        transformOrigin: "0 0",
        transform: `translate(${shot.ax - k * shot.fx}px, ${shot.ay - k * shot.fy}px) scale(${k})`,
      }}
    >
      {children}
    </div>
  );
}
