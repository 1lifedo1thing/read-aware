import { AbsoluteFill } from "remotion";
import { AppWindow } from "../components/AppWindow";
import { Camera, WINDOW, blendShot, leanShot, type Shot } from "../components/Camera";
import { Caption } from "../components/Caption";
import { Composer, StreamedText, ToolActivity, ToolStep, UserTurn, WordReferenceCard } from "../components/app/Chat";
import { PluginRow, PluginsPanelHeader, SettingsDialog, type InstalledPlugin } from "../components/app/Settings";
import { ShelfGrid } from "../components/app/Shelf";
import { arrive, easeIn, easeInOut, mix, progress, typed } from "../motion";
import { useSceneFrame } from "../scene-frame";
import { color } from "../theme";
import { BAR, BEAT } from "../timeline";

/**
 * Two bars. First, Settings → Plugins over the shelf: switches turn on with
 * the beat. Then the Agent page: asked about a word, the agent calls the
 * Dictionary plugin's own tool and answers with its entry — a plugin handing
 * the agent a skill.
 *
 * Plugin names, versions, descriptions and permission chips come from the
 * first-party manifests and the permission names in the app's en locale; the
 * tool label is the Dictionary plugin's registered `lookup_word` label.
 */

const PLUGINS: InstalledPlugin[] = [
  {
    name: "Dictionary",
    version: "1.4.0",
    description: "Look up words while you read, save them, and revisit full dictionary entries on a searchable timeline.",
    permissions: ["Read reading activity", "Read library", "AI requests", "Agent tools", "Agent retrieval"],
    bookAccess: true,
  },
  {
    name: "Editorial Themes",
    version: "1.0.0",
    description:
      "Two editorial themes for the whole app and the book page — Gutenberg, an aged-paper light theme, and Nocturne, a quiet ink-blue dark theme — set in the EB Garamond book face.",
    permissions: ["Themes"],
    bookAccess: true,
  },
  {
    name: "RSS Reader",
    version: "0.24.0",
    description: "Subscribe to RSS/Atom feeds and read each one as a book on your shelf — articles become chapters.",
    permissions: ["Network", "Manage library", "Control reading", "Agent tools"],
    bookAccess: true,
  },
  {
    name: "TTS Voices",
    version: "0.6.0",
    description:
      "Read-aloud voices from cloud and local TTS engines: ElevenLabs, Fish Audio, OpenAI, or any OpenAI-compatible endpoint (Kokoro, Piper, LocalAI…).",
    permissions: ["Network"],
    bookAccess: false,
  },
];

const AGENT_SHOT: Shot = { scale: 1.4, fx: WINDOW.w / 2, fy: 210, ax: 960, ay: 580 };

/** Dialog height: min(85vh, 42rem) inside the window. */
const DIALOG_H = Math.min(WINDOW.h * 0.85, 672);

// Frames, local to the scene.
const SWITCH_AT = [BEAT - 4, BEAT * 2 - 4, BEAT * 3 - 4];
const SCROLL = { from: BEAT * 2 + 2, to: BEAT * 3 - 6, by: 205 };
const CLOSE = BAR;
const ASK_IN = BAR + 4;
const QUESTION = "What does “entailed” mean in Pride and Prejudice?";
const TOOL = { from: ASK_IN + 6, done: ASK_IN + 16 };
/** The plugin's entry lands as soon as its tool returns; the answer follows. */
const CARD_IN = TOOL.done + 1;
const REPLY =
  "An entail fixes who may inherit an estate. Longbourn can pass only to a male heir — so the Bennet daughters inherit nothing.";
const ANSWER = { from: CARD_IN + 6, rate: 6 };

export function PluginsScene() {
  const frame = useSceneFrame();
  const open = progress(frame, 0, 12);
  const close = progress(frame, CLOSE, 8, easeIn);
  const dialog = open * (1 - close);
  const toAgent = progress(frame, CLOSE + 2, 10);
  const scroll = progress(frame, SCROLL.from, SCROLL.to - SCROLL.from, easeInOut) * SCROLL.by;
  const lean = progress(frame, 0, BAR, easeInOut);
  const agentLean = progress(frame, CLOSE, 40, easeInOut);
  // Settings: a slow lean toward the dialog. Agent: in close on the
  // conversation, framed below the caption.
  const shot = blendShot(leanShot(mix(1, 1.05, lean), WINDOW.w / 2, 360), AGENT_SHOT, agentLean);

  return (
    <AbsoluteFill>
      <Camera shot={shot}>
        {toAgent < 1 && (
          <AppWindow header="library">
            <div style={{ position: "absolute", inset: 0, filter: `blur(${(8 * dialog).toFixed(2)}px)` }}>
              <ShelfGrid />
            </div>
          </AppWindow>
        )}
        {/* The dialog's scrim covers the whole window, header included. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 11,
            background: `rgba(12,10,9,${(0.35 * dialog).toFixed(3)})`,
          }}
        />
        {dialog > 0 && (
          <div
            style={{
              position: "absolute",
              left: (WINDOW.w - 768) / 2,
              top: (WINDOW.h - DIALOG_H) / 2,
              opacity: dialog,
              transform: `scale(${mix(0.98, 1, open) * mix(1, 0.98, close)})`,
            }}
          >
            <SettingsDialog height={DIALOG_H}>
              <div style={{ padding: "40px 40px 0", transform: `translateY(${-scroll}px)` }}>
                <PluginsPanelHeader />
                <div style={{ marginTop: 6 }}>
                  {PLUGINS.map((plugin, i) => (
                    <PluginRow
                      key={plugin.name}
                      plugin={plugin}
                      on={i < SWITCH_AT.length ? progress(frame, SWITCH_AT[i]!, 6, easeInOut) : 0}
                    />
                  ))}
                </div>
              </div>
            </SettingsDialog>
          </div>
        )}
        {toAgent > 0 && (
          <div style={{ position: "absolute", inset: 0, opacity: toAgent }}>
            <AppWindow header="agent">
              <AgentPage frame={frame} />
            </AppWindow>
          </div>
        )}
      </Camera>
      <Caption eyebrow="Plugins" title="Extend the reader — and the agent." start={4} />
    </AbsoluteFill>
  );
}

/** The Agent page: the transcript column (max-w-2xl) over the library-wide composer. */
function AgentPage({ frame }: { frame: number }) {
  const reply = typed(REPLY, frame, ANSWER.from, ANSWER.rate);
  const toolsDone = frame >= TOOL.done;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: color.paper }}>
      <div style={{ flex: 1, overflow: "hidden", padding: "28px 24px 0" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <UserTurn text={QUESTION} style={arrive(progress(frame, ASK_IN, 10), 10, 3)} />
          {frame >= TOOL.from && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {toolsDone ? <ToolActivity summary="1 tool call" /> : <ToolStep label="Look up word" running frame={frame} />}
              {frame >= CARD_IN && (
                <WordReferenceCard
                  term="entail"
                  pronunciation="/ɪnˈteɪl/"
                  partOfSpeech="verb"
                  definition="settle the inheritance of an estate over generations, so that it passes only to a fixed line of heirs."
                  example="the estate was entailed on the nearest male relation"
                  style={{ maxWidth: 440, ...arrive(progress(frame, CARD_IN, 10), 8, 2) }}
                />
              )}
              {frame >= ANSWER.from && <StreamedText text={reply} done={reply.length === REPLY.length} />}
            </div>
          )}
        </div>
      </div>
      <Composer placeholder="Ask about your library…" maxWidth={672} />
    </div>
  );
}
