import { CursorIcon } from "@phosphor-icons/react";

/** A pointer at (x, y) — its tip, not its box — with an optional press. */
export function Cursor({
  x,
  y,
  opacity = 1,
  press = 0,
}: {
  x: number;
  y: number;
  opacity?: number;
  /** 0..1, how far into a click the pointer is. */
  press?: number;
}) {
  const scale = 1 - 0.14 * Math.sin(Math.PI * press);
  return (
    <div
      style={{
        position: "absolute",
        left: x - 6,
        top: y - 4,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "6px 4px",
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.28))",
      }}
    >
      {/* Two stacked glyphs give the system pointer its white keyline. */}
      <CursorIcon size={40} weight="bold" color="#ffffff" style={{ position: "absolute" }} />
      <CursorIcon size={40} weight="fill" color="#1c1917" style={{ position: "absolute" }} />
    </div>
  );
}
