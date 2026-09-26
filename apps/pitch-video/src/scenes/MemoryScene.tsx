import { ChatCircleIcon, HighlighterIcon, BookOpenIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { AppWindow, TOP_BAR_HEIGHT } from "../components/AppWindow";
import { Caption } from "../components/Caption";
import { arrive, easeInOut, mix, progress } from "../motion";
import { color, font, shadow } from "../theme";
import { BEAT } from "../timeline";
import { useSceneFrame } from "../scene-frame";

/**
 * The shelf, and the memory running through it: one thread the agent has
 * drawn across five books, echoing the thread in the app icon.
 *
 * Covers are Project Gutenberg editions (public domain). The thread's label
 * is taken from a real answer shown on the landing page ("Across everything,
 * four threads stand out…").
 */

const WIN = { x: 240, y: 236, w: 1440, h: 800 };
const COLS = 7;
const GAP = 30;
const PAD = 40;
const COVER_W = (WIN.w - PAD * 2 - GAP * (COLS - 1)) / COLS;
const COVER_H = COVER_W * 1.5;

// Gutenberg ebook numbers, row by row.
const SHELF = [
  [1342, 65661, 2641, 2000, 13951, 1260, 28054],
  [45304, 1513, 1184, 2554, 2701, 174, 1661],
  [64317, 5200, 345, 1399, 84, 1400, 11],
];

type Stop = { id: number; tag?: { icon: ReactNode; text: string } };
/** The thread, in drawing order. */
const THREAD: Stop[] = [
  { id: 1342, tag: { icon: <BookOpenIcon size={16} />, text: "Reading now" } },
  { id: 1513 },
  { id: 2641 },
  { id: 2554, tag: { icon: <HighlighterIcon size={16} />, text: "Your highlight · Part III" } },
  { id: 28054, tag: { icon: <ChatCircleIcon size={16} />, text: "Asked last week" } },
];

function cell(id: number) {
  for (let r = 0; r < SHELF.length; r++) {
    const c = SHELF[r]!.indexOf(id);
    if (c >= 0) return { r, c };
  }
  throw new Error(`Book ${id} is not on the shelf`);
}

function coverBox(r: number, c: number) {
  return { x: PAD + c * (COVER_W + GAP), y: PAD - 6 + r * (COVER_H + GAP) };
}

/** Frames are local to the scene. */
const DIM = BEAT;
const DRAW = { from: BEAT + 6, to: BEAT * 6 };
const LABEL = BEAT * 5 + 6;

export function MemoryScene() {
  const frame = useSceneFrame();
  const inThread = new Set(THREAD.map((s) => s.id));
  const dim = progress(frame, DIM, 16, easeInOut);
  const draw = progress(frame, DRAW.from, DRAW.to - DRAW.from, easeInOut);
  const camera = mix(1.03, 1, progress(frame, 0, 40));

  const points = THREAD.map(({ id }) => {
    const { r, c } = cell(id);
    const box = coverBox(r, c);
    return { x: box.x + COVER_W / 2, y: box.y + COVER_H / 2 };
  });
  const path = smoothPath(points);
  // Which stop the head of the line has reached, for per-cover timing.
  const reached = (i: number) => progress(frame, DRAW.from + (i / (THREAD.length - 1)) * (DRAW.to - DRAW.from) - 2, 10);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: WIN.x,
          top: WIN.y,
          transform: `scale(${camera})`,
          transformOrigin: "50% 40%",
        }}
      >
        <AppWindow width={WIN.w} height={WIN.h} topBar="library">
          <div style={{ position: "absolute", inset: 0 }}>
            {SHELF.flatMap((row, r) =>
              row.map((id, c) => {
                const box = coverBox(r, c);
                const lit = inThread.has(id);
                // Covers are already rising while the scene dissolves in.
                const rise = progress(frame, -6 + c * 1.5 + r * 3, 18);
                const stop = THREAD.findIndex((s) => s.id === id);
                const lift = lit ? reached(stop) : 0;
                return (
                  <div
                    key={id}
                    style={{
                      position: "absolute",
                      left: box.x,
                      top: box.y,
                      width: COVER_W,
                      height: COVER_H,
                      borderRadius: 4,
                      overflow: "hidden",
                      boxShadow: lit
                        ? `0 ${2 + 12 * lift}px ${6 + 26 * lift}px -6px rgba(28,25,23,${0.2 + 0.15 * lift})`
                        : "0 2px 6px -2px rgba(28,25,23,0.2)",
                      transform: `translateY(${(1 - rise) * 30 - lift * 6}px) scale(${1 + lift * 0.035})`,
                      opacity: rise * (lit ? 1 : mix(1, 0.26, dim)),
                      filter: lit ? undefined : `grayscale(${0.7 * dim})`,
                    }}
                  >
                    <Img
                      src={staticFile(`covers/${id}.jpg`)}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                );
              }),
            )}

            <svg
              width={WIN.w}
              height={WIN.h - TOP_BAR_HEIGHT}
              style={{ position: "absolute", inset: 0, overflow: "visible" }}
            >
              {/* A paper halo keeps the ink line legible where it crosses a cover. */}
              <path
                d={path}
                fill="none"
                stroke={color.surface}
                strokeWidth={9}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - draw}
                opacity={0.7}
              />
              <path
                d={path}
                fill="none"
                stroke={color.fg}
                strokeWidth={3}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - draw}
                opacity={0.85}
              />
              {points.map((p, i) => {
                const k = reached(i);
                return (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={9 * k}
                    fill={THREAD_DOT}
                    stroke={color.surface}
                    strokeWidth={3 * k}
                  />
                );
              })}
            </svg>

            {THREAD.map((stop, i) => {
              if (!stop.tag) return null;
              const { r, c } = cell(stop.id);
              const box = coverBox(r, c);
              const p = reached(i);
              return (
                <div
                  key={stop.id}
                  style={{
                    position: "absolute",
                    left: box.x + COVER_W / 2,
                    // Top-row tags hang below the cover; lower-row tags sit on top,
                    // clear of the thread card.
                    top: r === 0 ? box.y + COVER_H - 18 : box.y - 22,
                    transform: `translateX(-50%) translateY(${(1 - p) * 10}px)`,
                    opacity: p,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 11px",
                    borderRadius: 8,
                    background: color.surface,
                    boxShadow: shadow.float,
                    fontFamily: font.sans,
                    fontSize: 14,
                    fontWeight: 500,
                    color: color.fg,
                    whiteSpace: "nowrap",
                  }}
                >
                  {stop.tag.icon}
                  {stop.tag.text}
                </div>
              );
            })}
          </div>

          <ThreadCard frame={frame} />
        </AppWindow>
      </div>

      <Caption eyebrow="Memory across books" title="It remembers what you’ve read." start={4} />
    </AbsoluteFill>
  );
}

/** The terminal dot of the app icon's thread. */
const THREAD_DOT = "#b8966a";

function ThreadCard({ frame }: { frame: number }) {
  const p = progress(frame, LABEL, 16);
  return (
    <div
      style={{
        position: "absolute",
        left: (WIN.w - 760) / 2,
        bottom: 26,
        width: 760,
        padding: "24px 30px 26px",
        borderRadius: 14,
        background: color.surface,
        boxShadow: shadow.float,
        outline: `1px solid ${color.border}`,
        ...arrive(p, 20, 6),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: font.sans,
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: color.stone500,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 9, background: THREAD_DOT }} />A thread
        across your shelf
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: font.serif,
          fontSize: 30,
          lineHeight: 1.3,
          color: color.fg,
        }}
      >
        The individual squeezed against the social order.
      </div>
      <div style={{ marginTop: 8, fontFamily: font.sans, fontSize: 16, color: color.fgMuted }}>
        5 books · 23 highlights · 4 conversations
      </div>
    </div>
  );
}

/** A Catmull–Rom curve through the points, as cubic Béziers. */
function smoothPath(points: { x: number; y: number }[]) {
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const k = 0.22;
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
