import { arrive, progress } from "../motion";
import { color, font } from "../theme";
import { useSceneFrame } from "../scene-frame";

/**
 * The line of copy above each scene: a small sans eyebrow, then the claim in
 * Literata, arriving word by word.
 */
export function Caption({
  eyebrow,
  title,
  start = 0,
  top = 46,
}: {
  eyebrow: string;
  title: string;
  start?: number;
  top?: number;
}) {
  const frame = useSceneFrame();
  const words = title.split(" ");
  return (
    <div
      style={{
        position: "absolute",
        top,
        insetInline: 0,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: font.sans,
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: color.stone500,
          ...arrive(progress(frame, start, 16), 10, 4),
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: font.book,
          fontSize: 58,
          lineHeight: 1.1,
          letterSpacing: "-0.012em",
          color: color.fg,
        }}
      >
        {words.map((word, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              ...arrive(progress(frame, start + 3 + i * 2, 16), 22, 10),
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
