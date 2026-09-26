import {
  DatabaseIcon,
  GearSixIcon,
  InfoIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PuzzlePieceIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  BookOpenIcon,
  RowsIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { AbsoluteFill } from "remotion";
import { AppWindow } from "../components/AppWindow";
import { Caption } from "../components/Caption";
import { Toggle } from "../components/Toggle";
import { arrive, easeInOut, mix, progress } from "../motion";
import { color, font, shadow } from "../theme";
import { BEAT } from "../timeline";
import { useSceneFrame } from "../scene-frame";

/**
 * Settings → Plugins. Switches flip on the beat; each plugin that contributes
 * agent tools hands them to the agent, which lists them as its own.
 *
 * Names, versions, descriptions, permission chips and tool names are the
 * first-party plugins' real manifests and agentTools registrations.
 */

const WIN = { x: 240, y: 236, w: 1440, h: 800 };

type Plugin = {
  name: string;
  version: string;
  description: string;
  chips: string[];
  tools: string[];
};

const PLUGINS: Plugin[] = [
  {
    name: "Dictionary",
    version: "1.4.0",
    description: "Look up words as you read and keep them on a searchable timeline.",
    chips: ["AI requests", "Agent tools"],
    tools: ["lookup_word", "save_word"],
  },
  {
    name: "TTS Voices",
    version: "0.6.0",
    description: "Read-aloud voices from ElevenLabs, OpenAI, Kokoro, Piper and more.",
    chips: ["Network"],
    tools: [],
  },
  {
    name: "Editorial Themes",
    version: "1.0.0",
    description: "Gutenberg and Nocturne: two editorial themes set in EB Garamond.",
    chips: ["Themes"],
    tools: [],
  },
  {
    name: "RSS Reader",
    version: "0.24.0",
    description: "Read feeds as books on your shelf — articles become chapters.",
    chips: ["Network", "Manage shelf", "Agent tools"],
    tools: ["subscribe_feed", "refresh_feed"],
  },
  {
    name: "Jumper",
    version: "0.13.0",
    description: "Jump to any chapter, page or passage, and keep named bookmarks.",
    chips: ["Agent tools"],
    tools: ["save_bookmark"],
  },
];

/** Local frame at which plugin `i` switches on: one per beat from beat 1. */
const switchAt = (i: number) => BEAT * (i + 1) - 4;

export function PluginsScene() {
  const frame = useSceneFrame();
  // Settle in, then lean slowly toward the switches and the agent's tools.
  const camera = mix(1.03, 1, progress(frame, 0, 30)) * mix(1, 1.06, progress(frame, 24, 120, easeInOut));
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: WIN.x,
          top: WIN.y,
          transform: `scale(${camera})`,
          transformOrigin: "62% 55%",
        }}
      >
        <AppWindow width={WIN.w} height={WIN.h} topBar="library" background={color.surface}>
          <SettingsNav />
          <div style={{ position: "absolute", left: 300, top: 0, right: 0, bottom: 0, padding: "34px 52px" }}>
            <div style={{ fontFamily: font.serif, fontSize: 40, color: color.fg }}>Plugins</div>
            <Tabs />
            <div style={{ display: "flex", gap: 44, marginTop: 8 }}>
              <div style={{ width: 640 }}>
                {PLUGINS.map((plugin, i) => (
                  <PluginRow key={plugin.name} plugin={plugin} frame={frame} index={i} />
                ))}
              </div>
              <AgentTools frame={frame} />
            </div>
          </div>
        </AppWindow>
      </div>
      <Caption eyebrow="Plugins" title="Extend the reader — and the agent." start={4} />
    </AbsoluteFill>
  );
}

function SettingsNav() {
  const items = [
    [SlidersHorizontalIcon, "General"],
    [BookOpenIcon, "Reading"],
    [SparkleIcon, "AI"],
    [PuzzlePieceIcon, "Plugins"],
    [PaletteIcon, "Theme"],
    [RowsIcon, "Customize"],
    [KeyboardIcon, "Shortcuts"],
    [DatabaseIcon, "Data & Sync"],
    [InfoIcon, "About"],
  ] as const;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 300,
        borderRight: `1px solid ${color.border}`,
        background: color.paper,
        padding: "36px 22px",
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 21, fontWeight: 500, color: color.fg, padding: "0 12px 18px" }}>
        <GearSixIcon size={22} /> Settings
      </div>
      {items.map(([Icon, label]) => {
        const active = label === "Plugins";
        return (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              height: 46,
              padding: "0 12px",
              borderRadius: 8,
              fontSize: 18,
              background: active ? color.fillStrong : "transparent",
              color: active ? color.fg : color.fgMuted,
              fontWeight: active ? 500 : 400,
            }}
          >
            <Icon size={20} weight={active ? "fill" : "regular"} />
            {label}
          </div>
        );
      })}
    </div>
  );
}

function Tabs() {
  return (
    <div
      style={{
        display: "flex",
        gap: 32,
        marginTop: 18,
        borderBottom: `1px solid ${color.border}`,
        fontFamily: font.sans,
        fontSize: 18,
      }}
    >
      {["Installed", "Marketplace"].map((tab, i) => (
        <div
          key={tab}
          style={{
            paddingBottom: 12,
            color: i === 0 ? color.fg : color.fgMuted,
            fontWeight: i === 0 ? 500 : 400,
            borderBottom: i === 0 ? `2px solid ${color.fg}` : "2px solid transparent",
            marginBottom: -1,
          }}
        >
          {tab}
        </div>
      ))}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, color: color.fgSubtle, paddingBottom: 12 }}>
        <MagnifyingGlassIcon size={18} /> Search plugins…
      </div>
    </div>
  );
}

function PluginRow({ plugin, frame, index }: { plugin: Plugin; frame: number; index: number }) {
  const rise = progress(frame, -6 + index * 3, 16);
  const on = progress(frame, switchAt(index), 7, easeInOut);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "13px 0",
        borderTop: index === 0 ? "none" : `1px solid ${color.border}`,
        fontFamily: font.sans,
        ...arrive(rise, 16, 3),
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 500, color: color.fg }}>{plugin.name}</span>
          <span style={{ fontSize: 15, color: color.fgSubtle }}>v{plugin.version}</span>
        </div>
        <div style={{ marginTop: 5, fontSize: 15.5, lineHeight: 1.45, color: color.fgMuted }}>
          {plugin.description}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
          {plugin.chips.map((chip) => (
            <span
              key={chip}
              style={{
                fontSize: 13.5,
                padding: "4px 9px",
                borderRadius: 6,
                background: color.fill,
                color: color.fgMuted,
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
      <Toggle on={on} />
    </div>
  );
}

function AgentTools({ frame }: { frame: number }) {
  const granted = PLUGINS.flatMap((plugin, i) =>
    plugin.tools.map((tool) => ({ tool, from: plugin.name, at: switchAt(i) + 6 })),
  );
  const count = granted.filter((g) => frame >= g.at).length;
  const card = progress(frame, 0, 18);
  return (
    <div
      style={{
        flex: 1,
        alignSelf: "flex-start",
        marginTop: 18,
        padding: "22px 24px 18px",
        borderRadius: 14,
        background: color.paper,
        outline: `1px solid ${color.border}`,
        fontFamily: font.sans,
        ...arrive(card, 16, 3),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 500, color: color.fg }}>
        <WrenchIcon size={20} />
        Agent tools
        <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 400, color: color.fgMuted, fontVariantNumeric: "tabular-nums" }}>
          +{count} from plugins
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 15, color: color.fgMuted, lineHeight: 1.45 }}>
        The agent picks up new tools the moment a plugin is enabled.
      </div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 9 }}>
        {granted.map((g) => {
          const p = progress(frame, g.at, 12);
          if (p <= 0) return null;
          return (
            <div
              key={g.tool}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderRadius: 9,
                background: color.surface,
                boxShadow: shadow.float,
                transform: `translateX(${(1 - p) * -36}px) scale(${mix(0.96, 1, p)})`,
                opacity: p,
              }}
            >
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 16, color: color.fg }}>
                {g.tool}
              </span>
              <span style={{ fontSize: 14, color: color.fgSubtle }}>{g.from}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
