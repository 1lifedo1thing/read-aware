import { CursorIcon } from "@phosphor-icons/react";

/** A pointer at (x, y) — its tip, not its box — with an optional press. */
export function Cursor({
  x,
  y,
  opacity = 1,
  press = 0,
  size = 40,
}: {
  x: number;
  y: number;
  opacity?: number;
  /** 0..1, how far into a click the pointer is. */
  press?: number;
  size?: number;
}) {
  const scale = 1 - 0.14 * Math.sin(Math.PI * press);
  // The glyph's tip sits a little inside its box.
  const tip = { x: size * 0.15, y: size * 0.1 };
  return (
    <div
      style={{
        position: "absolute",
        left: x - tip.x,
        top: y - tip.y,
        width: size,
        height: size,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: `${tip.x}px ${tip.y}px`,
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.28))",
      }}
    >
      {/* Two stacked glyphs give the system pointer its white keyline. */}
      <CursorIcon size={size} weight="bold" color="#ffffff" style={{ position: "absolute" }} />
      <CursorIcon size={size} weight="fill" color="#1c1917" style={{ position: "absolute" }} />
    </div>
  );
}
