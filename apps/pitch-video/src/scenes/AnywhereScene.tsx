import { LockSimpleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { arrive, easeOut, progress } from "../motion";
import { color, font } from "../theme";
import { BEAT } from "../timeline";
import { useSceneFrame } from "../scene-frame";

/**
 * One bar of breadth: the format name flips on every eighth note while the
 * phone — an unmodified capture of the Android app (see
 * apps/landing/SCREENSHOTS.md) — slides in beside it.
 */

const FORMATS = ["EPUB", "MOBI", "AZW3", "FB2", "PDF", "TXT", "CBZ", "CBR"];
const STEP = BEAT / 2;
const PLATFORMS = ["macOS", "Windows", "Linux", "Android", "iOS"];

export function AnywhereScene() {
  const frame = useSceneFrame();
  const index = Math.min(FORMATS.length - 1, Math.floor(frame / STEP));
  const flip = progress(frame - index * STEP, 0, 5, easeOut);
  const phone = progress(frame, 0, 20);
  const lines = progress(frame, 6, 16);

  return (
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 150 }}>
      <div style={{ width: 820 }}>
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: color.stone500,
            ...arrive(progress(frame, 0, 12), 10, 4),
          }}
        >
          Bring almost any book
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: font.serif,
            fontSize: 150,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: color.fg,
            height: 170,
            overflow: "hidden",
          }}
        >
          {/* The outgoing name lifts away as the next one rises into its place. */}
          <div style={{ position: "relative" }}>
            {index > 0 && flip < 1 && (
              <div
                style={{
                  position: "absolute",
                  transform: `translateY(${-flip * 60}px)`,
                  opacity: 1 - flip,
                  filter: `blur(${flip * 6}px)`,
                }}
              >
                {FORMATS[index - 1]}
              </div>
            )}
            <div
              style={{
                transform: `translateY(${(1 - flip) * 60}px)`,
                opacity: flip,
                filter: flip < 1 ? `blur(${(1 - flip) * 6}px)` : undefined,
              }}
            >
              {FORMATS[index]}
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 34,
            fontFamily: font.serif,
            fontSize: 34,
            color: color.fg,
            ...arrive(lines, 14, 5),
          }}
        >
          {PLATFORMS.join("  ·  ")}
        </div>
        <div
          style={{
            marginTop: 22,
            display: "flex",
            gap: 30,
            fontFamily: font.sans,
            fontSize: 19,
            color: color.fgMuted,
            ...arrive(progress(frame, 12, 16), 14, 4),
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <LockSimpleIcon size={20} /> End-to-end encrypted sync
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <WifiSlashIcon size={20} /> Works fully offline
          </span>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          width: 372,
          height: 824,
          borderRadius: 56,
          padding: 12,
          background: "#1c1917",
          boxShadow: "0 30px 80px -24px rgba(28,25,23,0.45)",
          transform: `translateY(${(1 - phone) * 120}px) rotate(${(1 - phone) * 4}deg)`,
          opacity: phone,
        }}
      >
        <Img
          src={staticFile("android-reader.png")}
          style={{ width: "100%", height: "100%", borderRadius: 44, objectFit: "cover", display: "block" }}
        />
      </div>
    </AbsoluteFill>
  );
}
