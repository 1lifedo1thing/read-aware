import { AbsoluteFill, Img, spring, staticFile, useVideoConfig } from "remotion";
import { arrive, progress } from "../motion";
import { color, font } from "../theme";
import { useSceneFrame } from "../scene-frame";

/** The closing card, landing on the score's final chord. */
export function EndCard() {
  const frame = useSceneFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame, fps, config: { damping: 200, mass: 0.7 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Img
        src={staticFile("icon.png")}
        style={{
          width: 200,
          height: 200,
          opacity: icon,
          transform: `translateY(${(1 - icon) * 24}px) scale(${0.92 + 0.08 * icon})`,
          filter: "drop-shadow(0 18px 30px rgba(28,25,23,0.16))",
        }}
      />
      <div
        style={{
          marginTop: 18,
          fontFamily: font.book,
          fontSize: 112,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          color: color.fg,
          ...arrive(progress(frame, 4, 20), 20, 8),
        }}
      >
        ReadAware
      </div>
      <div
        style={{
          marginTop: 24,
          fontFamily: font.book,
          fontSize: 38,
          color: color.fgMuted,
          ...arrive(progress(frame, 10, 20), 16, 6),
        }}
      >
        An ebook reader with a self-evolving agent.
      </div>
      <div
        style={{
          marginTop: 44,
          fontFamily: font.sans,
          fontSize: 21,
          letterSpacing: "0.04em",
          color: color.stone500,
          ...arrive(progress(frame, 18, 20), 12, 4),
        }}
      >
        Free and open source  ·  readaware.app
      </div>
    </AbsoluteFill>
  );
}
