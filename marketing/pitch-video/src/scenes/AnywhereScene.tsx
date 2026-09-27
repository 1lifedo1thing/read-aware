import {
  BatteryFullIcon,
  CaretLeftIcon,
  CellSignalFullIcon,
  ChatCircleIcon,
  ListBulletsIcon,
  LockSimpleIcon,
  NotebookIcon,
  TextAaIcon,
  WifiHighIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { AbsoluteFill } from "remotion";
import { arrive, easeOut, progress } from "../motion";
import { useSceneFrame } from "../scene-frame";
import { color, font } from "../theme";
import { BEAT } from "../timeline";

/**
 * One bar of breadth: the format name flips on every eighth note while the
 * phone reader slides in beside it.
 */

const FORMATS = ["EPUB", "MOBI", "AZW3", "FB2", "PDF", "TXT", "CBZ", "CBR"];
const STEP = BEAT / 2;
const PLATFORMS = ["macOS", "Windows", "Linux", "Android", "iOS"];

export function AnywhereScene() {
  const frame = useSceneFrame();
  const index = Math.min(FORMATS.length - 1, Math.floor(frame / STEP));
  const flip = progress(frame - index * STEP, 0, 5, easeOut);
  const phone = progress(frame, 0, 20);

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
            fontFamily: font.book,
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
            fontFamily: font.book,
            fontSize: 34,
            color: color.fg,
            ...arrive(progress(frame, 6, 16), 14, 5),
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
          transform: `translateY(${(1 - phone) * 120}px) rotate(${(1 - phone) * 4}deg)`,
          opacity: phone,
        }}
      >
        <PhoneReader />
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- phone --

/** Logical phone viewport, drawn at SCALE on the frame. */
const PHONE = { w: 390, h: 844 };
const SCALE = 0.93;

const PAGE_TEXT = [
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
  "Mr. Bennet replied that he had not.",
];

/**
 * The phone reader as of 0.6.4 (ReaderShellOverlay, phone): title and
 * progress at the top; contents, notes, appearance and chat in a toolbar at
 * the bottom, within reach of the thumb.
 */
function PhoneReader() {
  return (
    <div
      style={{
        width: PHONE.w * SCALE + 24,
        height: PHONE.h * SCALE + 24,
        padding: 12,
        borderRadius: 60,
        background: "#1c1917",
        boxShadow: "0 30px 80px -24px rgba(28,25,23,0.45)",
      }}
    >
      <div style={{ width: PHONE.w * SCALE, height: PHONE.h * SCALE, borderRadius: 48, overflow: "hidden" }}>
        <div
          style={{
            position: "relative",
            width: PHONE.w,
            height: PHONE.h,
            transform: `scale(${SCALE})`,
            transformOrigin: "0 0",
            background: color.page,
            fontFamily: font.sans,
            color: color.fg,
          }}
        >
          <div
            style={{
              height: 50,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 30px 0 40px",
              background: color.paper,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600 }}>10:00</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <CellSignalFullIcon size={17} weight="fill" />
              <WifiHighIcon size={17} weight="bold" />
              <BatteryFullIcon size={24} weight="fill" />
            </span>
          </div>
          <div style={{ position: "relative", height: 52, background: color.paper }}>
            <CaretLeftIcon size={20} color={color.fgMuted} style={{ position: "absolute", left: 18, top: 16 }} />
            <div style={{ position: "absolute", insetInline: 0, top: 7, textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Pride and Prejudice</div>
              <div style={{ marginTop: 2, fontSize: 11, color: color.fgSubtle }}>Chapter I · 1%</div>
            </div>
            <div style={{ position: "absolute", insetInline: 0, bottom: 0, height: 1, background: color.border }} />
            <div
              style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: "2%", background: color.fgSubtle }}
            />
          </div>
          <div
            style={{
              padding: "34px 28px 0",
              fontFamily: font.book,
              fontSize: 18,
              lineHeight: 1.85,
              color: color.pageText,
            }}
          >
            <div style={{ textAlign: "center", fontSize: 24, color: color.stone500, marginBottom: 22 }}>Chapter I.</div>
            {PAGE_TEXT.map((text, i) => (
              <p key={i} style={{ margin: "0 0 14px", textIndent: i === 0 ? 0 : "1.2em" }}>
                {text}
              </p>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              insetInline: 0,
              bottom: 0,
              height: 84,
              background: color.paper,
              borderTop: `1px solid ${color.border}`,
            }}
          >
            <div
              style={{
                height: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-around",
                color: color.fgMuted,
              }}
            >
              <ListBulletsIcon size={21} />
              <NotebookIcon size={21} />
              <TextAaIcon size={21} />
              <ChatCircleIcon size={21} />
            </div>
            <div style={{ width: 134, height: 5, borderRadius: 5, background: color.fg, margin: "14px auto 0" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
