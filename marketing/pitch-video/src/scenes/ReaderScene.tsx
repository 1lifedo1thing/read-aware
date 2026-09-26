import type { ReactNode } from "react";
import { AbsoluteFill, interpolateColors } from "remotion";
import { AppWindow } from "../components/AppWindow";
import { Camera, REST_SHOT, blendShot, type Shot } from "../components/Camera";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import {
  AttachmentChip,
  BookReferenceCard,
  Composer,
  StreamedText,
  ToolActivity,
  ToolStep,
  UserTurn,
} from "../components/app/Chat";
import {
  NavigatorBar,
  ReaderTopBar,
  ReadoutChip,
  SELECTION_MENU_ASK_X,
  SELECTION_MENU_WIDTH,
  SelectionMenu,
} from "../components/app/ReaderChrome";
import { arrive, easeInOut, map, mix, progress, typed } from "../motion";
import { useSceneFrame } from "../scene-frame";
import { color, font } from "../theme";
import { BEAT, SCENES, at } from "../timeline";

/**
 * Opening, reader and ask, as one continuous shot: the first line of Pride
 * and Prejudice writes itself full-frame on the warm page, the camera pulls
 * back to reveal it as the focused sentence in sentence mode, focus steps
 * through the page, and then a selection becomes a question for the agent.
 */

// Page layout, in the window's logical pixels.
const COLUMN = { x: 120, w: 860 };
const PAGE_TOP = 56;
/** Centre of the opening sentence (below the chapter heading), for the opening shot. */
const OPENING_FOCUS = { x: COLUMN.x + COLUMN.w / 2, y: PAGE_TOP + 76 + 39 };

const OPENING_SHOT: Shot = { scale: 1.46, fx: OPENING_FOCUS.x, fy: OPENING_FOCUS.y, ax: 960, ay: 540 };
/** Leaning in on the answer, framed below the caption. */
const CHAT_SHOT: Shot = { scale: 1.42, fx: 900, fy: 300, ax: 1040, ay: 668 };

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
const CHIP_IN = PANEL_IN + 6;
const TYPE = { from: CHIP_IN + 4, rate: 2.4 };
const QUESTION = "Why open with a rule everyone “knows”?";
const SEND = TYPE.from + Math.ceil(QUESTION.length / TYPE.rate) + 4;
const TOOLS_DONE = SEND + 14;
const ANSWER = { from: TOOLS_DONE + 2, rate: 4.2 };
const REPLY =
  "Because it isn’t universal — that’s the joke. Austen states a rule so the novel can take it apart. You marked the same move in Crime and Punishment:";
const CARD_IN = ANSWER.from + Math.ceil(REPLY.length / ANSWER.rate);
const LEAN = { from: SEND + 4, to: SEND + 34 };
/** Lean back out of the chat so the next scene dissolves in the same window. */
const SETTLE = { from: SCENES.ask.to - 18, to: SCENES.ask.to - 2 };

const OPENING =
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.";
const PHRASE = "a truth universally acknowledged";

/** The rest of the chapter's opening, as the reader shows it. */
const REST = [
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
  "Mr. Bennet replied that he had not.",
  "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
  "Mr. Bennet made no answer.",
];

export function ReaderScene() {
  const frame = useSceneFrame();

  const pull = progress(frame, PULL.from, PULL.to - PULL.from, easeInOut);
  const drift = map(frame, [0, PULL.from], [0, 1]);
  const lean = progress(frame, LEAN.from, LEAN.to - LEAN.from, easeInOut);
  const settle = progress(frame, SETTLE.from, SETTLE.to - SETTLE.from, easeInOut);
  const opening = { ...OPENING_SHOT, scale: OPENING_SHOT.scale + 0.04 * (1 - drift) };
  const shot = blendShot(blendShot(blendShot(opening, REST_SHOT, pull), CHAT_SHOT, lean), REST_SHOT, settle);

  let focus = 0;
  STEPS.forEach((step) => {
    focus += progress(frame, step, 8, easeInOut);
  });
  const context = progress(frame, PULL.from + 8, 24); // the rest of the page arriving
  // Selecting to ask leaves sentence mode: every line returns to full ink.
  const sentenceMode = context * (1 - progress(frame, ASK - 4, 12, easeInOut));
  const bar = progress(frame, PULL.to + 2, 14);
  const controls = progress(frame, ASK - 2, 12);
  const panel = progress(frame, PANEL_IN, 14);

  return (
    <AbsoluteFill>
      {/* Full-frame the page is the whole picture; the stage shows as we pull back. */}
      <AbsoluteFill style={{ background: color.page, opacity: 1 - pull }} />
      <Camera shot={shot}>
        <AppWindow background={color.page} elevation={pull}>
          <Page frame={frame} focus={focus} sentenceMode={sentenceMode} context={context} />
          <ReadoutChip
            position={1 + Math.round(focus)}
            total={96}
            time={`0:${String(4 + Math.floor(Math.max(0, frame - PULL.to) / 30)).padStart(2, "0")}`}
            style={{ position: "absolute", top: 14, right: 16, opacity: sentenceMode }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 20,
              left: "50%",
              transform: `translateX(-50%) translateY(${(1 - bar) * 10}px)`,
              opacity: bar * (1 - controls),
            }}
          >
            <NavigatorBar />
          </div>
          <ReaderTopBar
            title="Pride and Prejudice"
            detail="3 / 612 · 1%"
            progress={0.01}
            chatActive={panel}
            style={{ transform: `translateY(${(controls - 1) * 48}px)`, opacity: controls }}
          />
          <ChatPanel frame={frame} reveal={panel} />
        </AppWindow>
      </Camera>

      <CaptionWindow from={PULL.to} to={ASK - 4} frame={frame}>
        <Caption eyebrow="Sentence by sentence" title="A calm place to read anything." start={PULL.to - 2} />
      </CaptionWindow>
      <CaptionWindow from={ASK - 2} to={SCENES.ask.to} frame={frame}>
        <Caption eyebrow="Context-aware AI" title="Ask from the page." start={ASK + 2} />
      </CaptionWindow>
    </AbsoluteFill>
  );
}

/** Keeps a caption on screen for a window, fading it out at the end. */
function CaptionWindow({ from, to, frame, children }: { from: number; to: number; frame: number; children: ReactNode }) {
  if (frame < from - 20 || frame > to) return null;
  return <AbsoluteFill style={{ opacity: 1 - progress(frame, to - 8, 8) }}>{children}</AbsoluteFill>;
}

// ------------------------------------------------------------------ page --

function Page({ frame, focus, sentenceMode, context }: { frame: number; focus: number; sentenceMode: number; context: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: COLUMN.x,
        width: COLUMN.w,
        top: PAGE_TOP,
        fontFamily: font.book,
        color: color.pageText,
      }}
    >
      <div style={{ textAlign: "center", fontSize: 28, lineHeight: "40px", color: color.stone500, marginBottom: 36, opacity: context }}>
        Chapter I.
      </div>
      <div style={{ fontSize: 21, lineHeight: 1.85, textAlign: "justify" }}>
        {["", ...REST].map((sentence, i) => {
          const lit = Math.max(0, 1 - Math.abs(i - focus));
          const ink = interpolateColors(mix(1, lit, sentenceMode), [0, 1], [color.pageMuted, color.pageText]);
          return (
            <p key={i} style={{ margin: "0 0 20px", textIndent: i === 0 ? 0 : "1.2em", opacity: i === 0 ? 1 : context }}>
              <span
                style={{
                  color: ink,
                  // The focus band: a soft box on each line of the current sentence.
                  background: `rgba(120, 104, 80, ${(0.12 * lit * sentenceMode).toFixed(3)})`,
                  borderRadius: 3,
                  padding: "4px 3px",
                  margin: "0 -3px",
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
  const words = (text: string) =>
    text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part, i) => {
        if (/^\s+$/.test(part)) return <span key={i}> </span>;
        const p = progress(frame, WORDS_START + index++ * WORD_STEP, 16);
        return (
          <span key={i} style={{ display: "inline-block", ...arrive(p, 10, 6) }}>
            {part}
          </span>
        );
      });
  const [before, after] = OPENING.split(PHRASE);
  return (
    <>
      {words(before!)}
      <Selected frame={frame}>{words(PHRASE)}</Selected>
      {words(after!)}
    </>
  );
}

// ------------------------------------------------------------ selection --

function Selected({ children, frame }: { children: ReactNode; frame: number }) {
  const drag = progress(frame, DRAG.from, DRAG.to - DRAG.from, easeInOut);
  const menu = progress(frame, MENU_IN, 8);
  const cursorIn = progress(frame, DRAG.from - 8, 8);
  const click = map(frame, [CLICK, CLICK + 6], [0, 1]);
  const gone = 1 - progress(frame, PANEL_IN + 2, 8);

  // Pointer path in the phrase's own box: drag across, then up to Ask AI on
  // the menu, which is centred over the phrase.
  const toMenu = progress(frame, MENU_IN + 1, CLICK - MENU_IN - 1, easeInOut);
  const askOffset = SELECTION_MENU_ASK_X - SELECTION_MENU_WIDTH / 2;
  const cursorLeft = `calc(${mix(mix(-2, 100, drag), 50, toMenu)}% + ${askOffset * toMenu}px)`;
  const cursorTop = mix(30, -30, toMenu);

  return (
    <span style={{ position: "relative", whiteSpace: "nowrap" }}>
      <span
        style={{
          position: "absolute",
          left: -2,
          top: 1,
          height: "calc(100% - 1px)",
          width: `calc(${drag * 100}% + 4px)`,
          background: color.selection,
          opacity: drag > 0 ? 1 : 0,
        }}
      />
      <span style={{ position: "relative" }}>{children}</span>
      {menu > 0 && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 12px)",
            transform: `translateX(-50%) translateY(${(1 - menu) * 6}px) scale(${mix(0.97, 1, menu)})`,
            opacity: menu * gone,
          }}
        >
          <SelectionMenu hot={map(frame, [CLICK - 4, CLICK], [0, 1])} />
        </span>
      )}
      {frame >= DRAG.from - 8 && frame < PANEL_IN + 10 && (
        <span style={{ position: "absolute", left: cursorLeft, top: cursorTop, width: 0, height: 0 }}>
          <Cursor x={0} y={0} opacity={cursorIn * gone} press={click} size={26} />
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- chat --

const PANEL_WIDTH = 352;

function ChatPanel({ frame, reveal }: { frame: number; reveal: number }) {
  if (reveal <= 0) return null;
  const sent = frame >= SEND;
  const reply = typed(REPLY, frame, ANSWER.from, ANSWER.rate);
  const toolsDone = frame >= TOOLS_DONE;
  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        bottom: 0,
        right: 0,
        width: PANEL_WIDTH,
        transform: `translateX(${(1 - reveal) * (PANEL_WIDTH + 24)}px)`,
        background: color.paper,
        borderLeft: `1px solid ${color.border}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16, overflow: "hidden" }}>
        {sent && (
          <>
            <UserTurn passage={PHRASE} text={QUESTION} style={arrive(progress(frame, SEND, 10), 10, 3)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {toolsDone ? (
                <ToolActivity summary="2 tool calls" />
              ) : (
                <>
                  <ToolStep label="Recalling memories" running={frame < SEND + 8} frame={frame} />
                  {frame >= SEND + 7 && <ToolStep label="Reading your highlights" running frame={frame} />}
                </>
              )}
              {frame >= ANSWER.from && <StreamedText text={reply} done={reply.length === REPLY.length} />}
              {frame >= CARD_IN && (
                <BookReferenceCard
                  cover="covers/2554.jpg"
                  title="Crime and Punishment"
                  author="Fyodor Dostoevsky"
                  progress={64}
                  style={arrive(progress(frame, CARD_IN, 10), 8, 2)}
                />
              )}
            </div>
          </>
        )}
      </div>
      <Composer
        placeholder="Ask about this book…"
        value={sent ? "" : typed(QUESTION, frame, TYPE.from, TYPE.rate)}
        caret={!sent && frame >= TYPE.from}
        chip={!sent && frame >= CHIP_IN ? <AttachmentChip text={PHRASE} style={arrive(progress(frame, CHIP_IN, 8), 6, 2)} /> : undefined}
      />
    </div>
  );
}
