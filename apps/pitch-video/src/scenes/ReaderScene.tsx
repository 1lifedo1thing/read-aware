import {
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleIcon,
  CheckIcon,
  CopyIcon,
  CrosshairIcon,
  HighlighterIcon,
  ListBulletsIcon,
  NotebookIcon,
  NotePencilIcon,
  SpeakerHighIcon,
  TextAaIcon,
  TextUnderlineIcon,
  XIcon,
  ArrowUpIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AbsoluteFill, interpolateColors } from "remotion";
import { AppWindow } from "../components/AppWindow";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { arrive, easeInOut, map, mix, progress, typed } from "../motion";
import { color, font, shadow } from "../theme";
import { BEAT, SCENES, at } from "../timeline";
import { useSceneFrame } from "../scene-frame";

/**
 * Opening, reader and ask, as one continuous shot: the first line of Pride
 * and Prejudice writes itself full-frame, the camera pulls back to reveal it
 * as the focused sentence in the reader, focus steps through the page, and
 * then a selection turns into a question for the agent.
 */

const WIN = { x: 240, y: 236, w: 1440, h: 800 };
/**
 * Camera shots, each a scale plus a focus point (window coordinates) and the
 * screen point it lands on. Blending the three numbers keeps every move
 * continuous: the opening sits full-frame on the first sentence, the rest
 * shot shows the whole window, and the chat shot leans in on the answer.
 */
type Shot = { scale: number; fx: number; fy: number; ax: number; ay: number };
const OPENING_SHOT: Shot = { scale: 1.46, fx: 720, fy: 238, ax: 960, ay: 540 };
const REST_SHOT: Shot = { scale: 1, fx: 720, fy: 238, ax: WIN.x + 720, ay: WIN.y + 238 };
const CHAT_SHOT: Shot = { scale: 1.3, fx: 1170, fy: 330, ax: 960, ay: 628 };
const blend = (a: Shot, b: Shot, p: number): Shot => ({
  scale: mix(a.scale, b.scale, p),
  fx: mix(a.fx, b.fx, p),
  fy: mix(a.fy, b.fy, p),
  ax: mix(a.ax, b.ax, p),
  ay: mix(a.ay, b.ay, p),
});

// Frames.
const WORDS_START = 6;
const WORD_STEP = 4;
const PULL = { from: at(2, 2), to: SCENES.reader.from + 2 };
const STEPS = [at(3, 3), at(4, 1), at(4, 3)];
const ASK = SCENES.ask.from;
const DRAG = { from: ASK + 6, to: ASK + BEAT + 6 };
const MENU_IN = DRAG.to + 1;
const CLICK = at(5, 2);
const PANEL_IN = CLICK + 4;
const QUESTION_IN = PANEL_IN + 12;
const TOOL_1 = QUESTION_IN + 9;
const TOOL_2 = TOOL_1 + 8;
const ANSWER_IN = TOOL_2 + 9;
const ANSWER_RATE = 3.4;
/** Lean back out of the chat so the next scene dissolves in the same window. */
const SETTLE = { from: SCENES.ask.to - 18, to: SCENES.ask.to - 2 };

const OPENING =
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.";

/** The page after the opening line, which is rendered word by word. */
const REST = [
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
  "Mr. Bennet replied that he had not.",
  "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
  "Mr. Bennet made no answer.",
];

const QUESTION = "Why open with a rule everyone “knows”?";
const ANSWER =
  "Because it isn’t universal — that’s the joke. Austen states a rule so the novel can take it apart. You marked the same move in Crime and Punishment.";

export function ReaderScene() {
  const frame = useSceneFrame();

  // Camera: full-frame on the sentence, then pull back to the window at rest.
  const pull = progress(frame, PULL.from, PULL.to - PULL.from, easeInOut);
  const drift = map(frame, [0, PULL.from], [0, 1]);
  const lean = progress(frame, PANEL_IN + 8, 34, easeInOut);
  const opening = { ...OPENING_SHOT, scale: OPENING_SHOT.scale + 0.04 * (1 - drift) };
  const rest = { ...REST_SHOT, scale: mix(1, 1.015, map(frame, [PULL.to, PANEL_IN], [0, 1])) };
  const settle = progress(frame, SETTLE.from, SETTLE.to - SETTLE.from, easeInOut);
  const shot = blend(blend(blend(opening, rest, pull), CHAT_SHOT, lean), REST_SHOT, settle);
  const scale = shot.scale;
  const tx = shot.ax - scale * shot.fx;
  const ty = shot.ay - scale * shot.fy;

  // Sentence focus: which sentence is lit, stepping on the beat.
  let focus = 0;
  STEPS.forEach((step) => {
    focus += progress(frame, step, 8, easeInOut);
  });
  // Selecting to ask leaves focus mode: every line returns to full ink.
  const focusMode = 1 - progress(frame, ASK - 4, 12, easeInOut);
  const ctx = progress(frame, PULL.from + 8, 24); // the rest of the page arriving

  const panel = progress(frame, PANEL_IN, 16);
  const pageShift = -110 * panel;

  return (
    <AbsoluteFill>
      {/* Full-frame the page is the whole picture; the stage shows as we pull back. */}
      <AbsoluteFill style={{ background: color.page, opacity: 1 - pull }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        <AppWindow
          width={WIN.w}
          height={WIN.h}
          topBar="none"
          background={color.page}
          elevation={pull}
        >
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${pageShift}px)` }}>
            <Page frame={frame} focus={focus} focusMode={focusMode} context={ctx} />
          </div>
          <PageCounter frame={frame} focus={focus} opacity={ctx * (1 - panel)} />
          <ReaderToolbar opacity={progress(frame, PULL.to + 2, 14)} shift={pageShift} />
          <ChatPanel frame={frame} reveal={panel} />
        </AppWindow>
      </div>

      <Sequenced from={PULL.to} to={ASK - 4} frame={frame}>
        <Caption eyebrow="Sentence by sentence" title="A calm place to read anything." start={PULL.to - 2} />
      </Sequenced>
      <Sequenced from={ASK - 2} to={SCENES.ask.to} frame={frame}>
        <Caption eyebrow="Context-aware AI" title="Ask from the page." start={ASK + 2} />
      </Sequenced>
    </AbsoluteFill>
  );
}

/** Keeps a caption on screen for a window, fading it out at the end. */
function Sequenced({
  from,
  to,
  frame,
  children,
}: {
  from: number;
  to: number;
  frame: number;
  children: ReactNode;
}) {
  if (frame < from - 20 || frame > to) return null;
  const out = 1 - progress(frame, to - 8, 8);
  return <AbsoluteFill style={{ opacity: out }}>{children}</AbsoluteFill>;
}

// ------------------------------------------------------------------ page --

function Page({
  frame,
  focus,
  focusMode,
  context,
}: {
  frame: number;
  focus: number;
  focusMode: number;
  context: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 170,
        width: 1100,
        top: 78,
        fontFamily: font.serif,
        color: color.pageText,
      }}
    >
      <div
        style={{
          textAlign: "center",
          fontSize: 44,
          color: color.stone500,
          marginBottom: 34,
          opacity: context,
        }}
      >
        Chapter I.
      </div>
      <div style={{ fontSize: 29, lineHeight: 1.95 }}>
        {["", ...REST].map((sentence, i) => {
          const lit = Math.max(0, 1 - Math.abs(i - focus));
          const weight = mix(1, lit, focusMode);
          const ink = interpolateColors(weight, [0, 1], [color.pageMuted, color.pageText]);
          // The focus band arrives with the rest of the page, not under the opening words.
          const bg = `rgba(168, 162, 158, ${(0.2 * lit * focusMode * context).toFixed(3)})`;
          return (
            <p
              key={i}
              style={{
                margin: 0,
                marginTop: i === 0 ? 0 : 16,
                textIndent: i === 0 ? 0 : "1.4em",
                opacity: i === 0 ? 1 : context,
              }}
            >
              <span
                style={{
                  color: ink,
                  background: bg,
                  borderRadius: 5,
                  padding: "3px 4px",
                  margin: "0 -4px",
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                }}
              >
                {i === 0 ? <OpeningLine frame={frame} /> : sentence}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

/** The first sentence, arriving word by word under the opening shot. */
function OpeningLine({ frame }: { frame: number }) {
  let index = 0;
  const word = (w: string) => {
    const p = progress(frame, WORDS_START + index++ * WORD_STEP, 16);
    return (
      <span style={{ display: "inline-block", ...arrive(p, 10, 6) }}>{w}</span>
    );
  };
  // Split around the selectable phrase so the Ask beat can anchor to it.
  const [before, after] = OPENING.split("a truth universally acknowledged");
  const words = (text: string) =>
    text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part, i) => (/^\s+$/.test(part) ? <span key={i}> </span> : <span key={i}>{word(part)}</span>));
  return (
    <>
      {words(before!)}
      <Selected frame={frame}>{words("a truth universally acknowledged")}</Selected>
      {words(after!)}
    </>
  );
}

// ------------------------------------------------------------ selection --

function Selected({ children, frame }: { children: ReactNode; frame: number }) {
  const drag = progress(frame, DRAG.from, DRAG.to - DRAG.from, easeInOut);
  const menu = progress(frame, MENU_IN, 10);
  const cursorIn = progress(frame, DRAG.from - 8, 8);
  const click = map(frame, [CLICK, CLICK + 6], [0, 1]);
  const panelOut = 1 - progress(frame, PANEL_IN + 2, 8);

  // Pointer path in the phrase's own box: drag across, then up to "Ask AI".
  const toMenu = progress(frame, MENU_IN + 1, CLICK - MENU_IN - 1, easeInOut);
  const cursorX = mix(mix(-4, 100, drag), 88, toMenu); // percent of phrase width
  const cursorY = mix(44, -52, toMenu); // px from the phrase top

  return (
    <span style={{ position: "relative", whiteSpace: "nowrap" }}>
      <span
        style={{
          position: "absolute",
          left: -3,
          top: 2,
          height: "calc(100% - 2px)",
          width: `calc(${drag * 100}% + 6px)`,
          background: color.selection,
          borderRadius: 4,
          opacity: drag > 0 ? 1 : 0,
        }}
      />
      <span style={{ position: "relative" }}>{children}</span>
      {menu > 0 && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 14px)",
            transform: `translateX(-50%) translateY(${(1 - menu) * 8}px) scale(${mix(0.96, 1, menu)})`,
            opacity: menu * panelOut,
          }}
        >
          <SelectionMenu hot={map(frame, [CLICK - 4, CLICK], [0, 1])} />
        </span>
      )}
      {frame >= DRAG.from - 8 && frame < PANEL_IN + 10 && (
        <span
          style={{
            position: "absolute",
            left: `${cursorX}%`,
            top: cursorY,
            width: 0,
            height: 0,
          }}
        >
          <Cursor x={0} y={0} opacity={cursorIn * panelOut} press={click} />
        </span>
      )}
    </span>
  );
}

function SelectionMenu({ hot }: { hot: number }) {
  const item = (icon: ReactNode, label?: string, active = 0) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 40,
        padding: label ? "0 14px 0 12px" : "0 11px",
        borderRadius: 8,
        background: `rgba(28,25,23,${0.07 * active})`,
      }}
    >
      {icon}
      {label}
    </span>
  );
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 5,
        borderRadius: 12,
        background: color.surface,
        boxShadow: shadow.float,
        outline: `1px solid ${color.border}`,
        fontFamily: font.sans,
        fontSize: 16,
        fontWeight: 500,
        color: color.fg,
        whiteSpace: "nowrap",
      }}
    >
      {item(<CopyIcon size={19} />)}
      {item(<HighlighterIcon size={19} />)}
      {item(<TextUnderlineIcon size={19} />)}
      {item(<NotePencilIcon size={19} />)}
      <span style={{ width: 1, height: 22, background: color.border, margin: "0 3px" }} />
      {item(<ChatCircleIcon size={19} />, "Ask AI about this", hot)}
    </span>
  );
}

// -------------------------------------------------------------- chrome --

function PageCounter({ frame, focus, opacity }: { frame: number; focus: number; opacity: number }) {
  const seconds = 42 + Math.floor(Math.max(0, frame - PULL.to) / 30);
  return (
    <div
      style={{
        position: "absolute",
        top: 18,
        right: 22,
        display: "flex",
        gap: 12,
        padding: "7px 14px",
        borderRadius: 8,
        background: color.surface,
        boxShadow: shadow.float,
        fontFamily: font.sans,
        fontSize: 15,
        color: color.fgSubtle,
        fontVariantNumeric: "tabular-nums",
        opacity,
      }}
    >
      <span>{1 + Math.round(focus)} / 1327</span>
      <span style={{ color: color.borderStrong }}>|</span>
      <span>0:{String(seconds).padStart(2, "0")}</span>
    </div>
  );
}

function ReaderToolbar({ opacity, shift }: { opacity: number; shift: number }) {
  const groups = [
    [CaretLeftIcon, CaretRightIcon, SpeakerHighIcon],
    [CrosshairIcon],
    [ListBulletsIcon, NotebookIcon, TextAaIcon, ChatCircleIcon],
    [XIcon],
  ];
  return (
    <div
      style={{
        position: "absolute",
        bottom: 26,
        left: "50%",
        transform: `translateX(calc(-50% + ${shift}px)) translateY(${(1 - opacity) * 14}px)`,
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 12,
        background: color.surface,
        boxShadow: shadow.float,
        outline: `1px solid ${color.border}`,
        color: color.fgMuted,
      }}
    >
      {groups.map((group, g) => (
        <div key={g} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {g > 0 && <div style={{ width: 1, height: 22, background: color.border, marginRight: 6 }} />}
          {group.map((Icon, i) => (
            <div key={i} style={{ width: 38, height: 38, display: "grid", placeItems: "center" }}>
              <Icon size={21} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- chat --

function ChatPanel({ frame, reveal }: { frame: number; reveal: number }) {
  if (reveal <= 0) return null;
  const width = 540;
  const answer = typed(ANSWER, frame, ANSWER_IN, ANSWER_RATE);
  const done = answer.length === ANSWER.length;
  const chip = progress(frame, ANSWER_IN + ANSWER.length / ANSWER_RATE + 2, 12);
  const tool = (label: string, start: number) => {
    const p = progress(frame, start, 10);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, ...arrive(p, 8, 3) }}>
        <CheckIcon size={16} weight="bold" color={color.stone500} />
        <span>{label}</span>
      </div>
    );
  };
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        width,
        transform: `translateX(${(1 - reveal) * (width + 40)}px)`,
        background: color.surface,
        borderLeft: `1px solid ${color.border}`,
        boxShadow: "-24px 0 60px -30px rgba(28,25,23,0.25)",
        fontFamily: font.sans,
        color: color.fg,
      }}
    >
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: "0 30px",
          borderBottom: `1px solid ${color.border}`,
          fontSize: 17,
          fontWeight: 500,
          gap: 10,
        }}
      >
        Pride and Prejudice
        <span style={{ color: color.fgSubtle, fontWeight: 400 }}>· Chapter I</span>
      </div>

      <div style={{ padding: "28px 30px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", ...arrive(progress(frame, QUESTION_IN, 12), 14, 4) }}>
          <div
            style={{
              borderLeft: `2px solid ${color.borderStrong}`,
              padding: "2px 0 2px 12px",
              fontFamily: font.serif,
              fontStyle: "italic",
              fontSize: 17,
              color: color.fgMuted,
              alignSelf: "stretch",
              marginLeft: 70,
              marginBottom: 10,
            }}
          >
            a truth universally acknowledged
          </div>
          <div
            style={{
              background: color.fill,
              borderRadius: 14,
              padding: "12px 16px",
              fontSize: 18,
              lineHeight: 1.45,
              maxWidth: 400,
            }}
          >
            {QUESTION}
          </div>
        </div>

        <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 9, fontSize: 15.5, color: color.fgMuted }}>
          {tool("Recalling memories", TOOL_1)}
          {tool("Reading your highlights", TOOL_2)}
        </div>

        <div
          style={{
            marginTop: 20,
            fontFamily: font.serif,
            fontSize: 21,
            lineHeight: 1.62,
            color: color.fg,
            minHeight: 140,
          }}
        >
          {answer}
          {!done && frame >= ANSWER_IN && (
            <span
              style={{
                display: "inline-block",
                width: 9,
                height: 9,
                borderRadius: 9,
                marginLeft: 6,
                background: color.fg,
                opacity: 0.55,
              }}
            />
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            background: color.fill,
            fontSize: 15,
            color: color.fgMuted,
            ...arrive(chip, 8, 3),
          }}
        >
          <NotebookIcon size={17} />
          Your highlight · <span style={{ fontFamily: font.serif, fontStyle: "italic", color: color.fg }}>Crime and Punishment</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 22,
          right: 22,
          bottom: 22,
          height: 56,
          borderRadius: 12,
          outline: `1px solid ${color.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px 0 18px",
          fontFamily: font.serif,
          fontSize: 18,
          color: color.fgSubtle,
        }}
      >
        Ask about this passage…
        <div style={{ width: 34, height: 34, borderRadius: 34, background: color.fillStrong, display: "grid", placeItems: "center" }}>
          <ArrowUpIcon size={17} color={color.fgMuted} />
        </div>
      </div>
    </div>
  );
}
