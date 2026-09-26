import { BookOpenIcon, ChatCircleIcon, HighlighterIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { AppWindow, HEADER_HEIGHT } from "../components/AppWindow";
import { Camera, WINDOW, leanShot } from "../components/Camera";
import { Caption } from "../components/Caption";
import { COVER_H, COVER_W, ShelfGrid, findBook, tileBox } from "../components/app/Shelf";
import { arrive, easeInOut, mix, progress } from "../motion";
import { useSceneFrame } from "../scene-frame";
import { color, font, shadow } from "../theme";
import { BEAT } from "../timeline";

/**
 * The shelf, and the memory running through it: one thread the agent has
 * drawn across five books, echoing the thread in the app icon.
 *
 * The thread and its tags are the film's illustration of memory, not app
 * chrome; the thread's label is a real answer shown on the landing page
 * ("Across everything, four threads stand out…").
 */

type Stop = { id: number; tag?: { icon: ReactNode; text: string } };
/** The thread, in drawing order: a wave across two rows. */
const THREAD: Stop[] = [
  { id: 1342, tag: { icon: <BookOpenIcon size={13} />, text: "Reading now" } },
  { id: 1513 },
  { id: 2641 },
  { id: 2554, tag: { icon: <HighlighterIcon size={13} />, text: "Your highlight · Part III" } },
  { id: 28054, tag: { icon: <ChatCircleIcon size={13} />, text: "Asked last week" } },
];

/** Frames are local to the scene. */
const DIM = BEAT;
const DRAW = { from: BEAT + 6, to: BEAT * 6 };
const LABEL = BEAT * 5 + 6;
/** The terminal dot of the app icon's thread. */
const THREAD_DOT = "#b8966a";

export function MemoryScene() {
  const frame = useSceneFrame();
  const inThread = new Set(THREAD.map((s) => s.id));
  const dim = progress(frame, DIM, 16, easeInOut);
  const draw = progress(frame, DRAW.from, DRAW.to - DRAW.from, easeInOut);
  const push = progress(frame, 12, 130, easeInOut);

  const points = THREAD.map(({ id }) => {
    const { r, c } = findBook(id);
    const b = tileBox(r, c);
    return { x: b.x + COVER_W / 2, y: b.y + COVER_H / 2 };
  });
  const reached = (i: number) =>
    progress(frame, DRAW.from + (i / (THREAD.length - 1)) * (DRAW.to - DRAW.from) - 2, 10);

  return (
    <AbsoluteFill>
      <Camera shot={leanShot(mix(1, 1.04, push), WINDOW.w / 2, 300)}>
        <AppWindow header="library">
          <ShelfGrid
            tileStyle={(tile, r, c) => {
              const lit = typeof tile === "number" && inThread.has(tile);
              // Tiles are already rising while the scene dissolves in.
              const rise = progress(frame, -6 + c * 1.5 + r * 3, 18);
              const lift = lit ? reached(THREAD.findIndex((s) => s.id === tile)) : 0;
              return {
                boxShadow: lit
                  ? `0 ${2 + 10 * lift}px ${4 + 20 * lift}px -4px rgba(28,25,23,${0.18 + 0.14 * lift})`
                  : shadow.cover,
                transform: `translateY(${(1 - rise) * 24 - lift * 4}px) scale(${1 + lift * 0.03})`,
                opacity: rise * (lit ? 1 : mix(1, 0.28, dim)),
                filter: lit ? undefined : `grayscale(${0.7 * dim})`,
              };
            }}
          />

          <svg
            width={WINDOW.w}
            height={WINDOW.h - HEADER_HEIGHT}
            style={{ position: "absolute", inset: 0, overflow: "visible" }}
          >
            {/* A paper halo keeps the ink line legible where it crosses a cover. */}
            {[
              { stroke: color.paper, width: 6, opacity: 0.75 },
              { stroke: color.fg, width: 2, opacity: 0.85 },
            ].map((line) => (
              <path
                key={line.width}
                d={smoothPath(points)}
                fill="none"
                stroke={line.stroke}
                strokeWidth={line.width}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - draw}
                opacity={line.opacity}
              />
            ))}
            {points.map((p, i) => {
              const k = reached(i);
              return <circle key={i} cx={p.x} cy={p.y} r={6 * k} fill={THREAD_DOT} stroke={color.paper} strokeWidth={2 * k} />;
            })}
          </svg>

          {THREAD.map((stop, i) => {
            if (!stop.tag) return null;
            const { r, c } = findBook(stop.id);
            const b = tileBox(r, c);
            const p = reached(i);
            return (
              <div
                key={stop.id}
                style={{
                  position: "absolute",
                  left: b.x + COVER_W / 2,
                  // Top-row tags hang below the cover, lower-row tags sit above
                  // it; both land in the grid's gutter.
                  top: r === 0 ? b.y + COVER_H - 12 : b.y - 14,
                  transform: `translateX(-50%) translateY(${(1 - p) * 8}px)`,
                  opacity: p,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 26,
                  padding: "0 9px",
                  borderRadius: 6,
                  background: color.paper,
                  boxShadow: `0 0 0 1px ${color.border}, ${shadow.float}`,
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                {stop.tag.icon}
                {stop.tag.text}
              </div>
            );
          })}

          <ThreadCard frame={frame} />
        </AppWindow>
      </Camera>

      <Caption eyebrow="Memory across books" title="It remembers what you’ve read." start={4} />
    </AbsoluteFill>
  );
}

function ThreadCard({ frame }: { frame: number }) {
  const width = 520;
  return (
    <div
      style={{
        position: "absolute",
        left: (WINDOW.w - width) / 2,
        bottom: 18,
        width,
        padding: "16px 20px 18px",
        borderRadius: 8,
        background: color.paper,
        boxShadow: `0 0 0 1px ${color.border}, ${shadow.float}`,
        ...arrive(progress(frame, LABEL, 16), 16, 5),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: color.stone500,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 7, background: THREAD_DOT }} />A thread across your shelf
      </div>
      <div style={{ marginTop: 8, fontFamily: font.appSerif, fontSize: 21, lineHeight: 1.3 }}>
        The individual squeezed against the social order.
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: color.fgMuted }}>5 books · 23 highlights · 4 conversations</div>
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
