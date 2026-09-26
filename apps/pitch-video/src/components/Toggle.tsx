import { interpolateColors } from "remotion";
import { mix } from "../motion";
import { color } from "../theme";

/** The settings switch, driven by an explicit 0..1 `on` rather than state. */
export function Toggle({ on }: { on: number }) {
  const w = 52;
  const h = 30;
  const knob = h - 6;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: h,
        background: interpolateColors(on, [0, 1], [color.fillStrong, color.fg]),
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: mix(3, w - knob - 3, on),
          width: knob,
          height: knob,
          borderRadius: knob,
          background: "#ffffff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </div>
  );
}
