import {
  BookOpenIcon,
  DatabaseIcon,
  InfoIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PuzzlePieceIcon,
  RowsIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { interpolateColors } from "remotion";
import { mix } from "../../motion";
import { color, font } from "../../theme";

/**
 * Settings → Plugins, restated from apps/web/src/features/settings
 * (SettingsDialog) and features/plugins (the installed-plugin rows), with the
 * shared Toggle from packages/ui.
 */

const CORE: [Icon, string][] = [
  [SlidersHorizontalIcon, "General"],
  [BookOpenIcon, "Reading"],
  [SparkleIcon, "AI"],
  [PuzzlePieceIcon, "Plugins"],
  [PaletteIcon, "Theme"],
  [RowsIcon, "Customize"],
  [KeyboardIcon, "Shortcuts"],
  [DatabaseIcon, "Data & Sync"],
  [InfoIcon, "About"],
];

/** Enabled plugins that declare settings get their own sections under a divider. */
const PLUGIN_SECTIONS = ["RSS Reader", "Sentence Reader", "TTS Voices", "WebDAV Sync"];

/** Dialog: max-w-3xl, h-[min(85vh,42rem)], rounded-md, border, on the main surface. */
export function SettingsDialog({
  height,
  children,
  style,
}: {
  height: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: 768,
        height,
        overflow: "hidden",
        borderRadius: 6,
        background: color.paper,
        boxShadow: `0 0 0 1px ${color.border}, 0 24px 60px -20px rgba(12,10,9,0.35)`,
        fontFamily: font.sans,
        color: color.fg,
        ...style,
      }}
    >
      <nav
        style={{
          width: 192,
          flexShrink: 0,
          padding: 12,
          borderRight: "1px solid rgba(28,25,23,0.07)",
          position: "relative",
        }}
      >
        <div style={{ fontFamily: font.appSerif, fontSize: 16, fontWeight: 500, padding: "6px 12px 10px" }}>
          Settings
        </div>
        {CORE.map(([IconC, label]) => (
          <NavRow key={label} icon={IconC} label={label} active={label === "Plugins"} />
        ))}
        <div style={{ height: 1, background: color.border, margin: "8px 12px" }} />
        {PLUGIN_SECTIONS.map((label) => (
          <NavRow key={label} icon={PuzzlePieceIcon} label={label} />
        ))}
      </nav>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <XIcon size={16} color={color.fgMuted} style={{ position: "absolute", top: 22, right: 22, zIndex: 2 }} />
        {children}
      </div>
    </div>
  );
}

function NavRow({ icon: IconC, label, active = false }: { icon: Icon; label: string; active?: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 36,
        padding: "0 12px",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: active ? 500 : 400,
        color: active ? color.fg : color.fgMuted,
      }}
    >
      {/* The sliding active-section indicator. */}
      {active && <div style={{ position: "absolute", left: -7, top: 9, width: 2, height: 18, background: color.fg }} />}
      <IconC size={16} weight={active ? "fill" : "regular"} />
      {label}
    </div>
  );
}

/** The Plugins panel header: title, trust note, tabs and search. */
export function PluginsPanelHeader() {
  return (
    <div>
      <div style={{ fontFamily: font.appSerif, fontSize: 24, lineHeight: "31px" }}>Plugins</div>
      <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7, color: color.fgMuted }}>
        Plugins run inside the app with the same access as the app itself. Install only plugins you trust.
      </div>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "flex-end",
          gap: 24,
          fontSize: 14,
          fontWeight: 500,
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <span style={{ paddingBottom: 10, borderBottom: `2px solid ${color.fg}`, marginBottom: -1 }}>Installed</span>
        <span style={{ paddingBottom: 12, color: color.fgMuted }}>Marketplace</span>
        <span style={{ paddingBottom: 12, color: color.fgMuted, marginLeft: "auto" }}>Install plugin…</span>
        <span style={{ paddingBottom: 12, color: color.fgMuted }}>Install from zip…</span>
      </div>
      <div
        style={{
          marginTop: 16,
          height: 34,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          boxShadow: `inset 0 0 0 1px ${color.border}`,
          fontSize: 14,
          color: color.fgSubtle,
        }}
      >
        <MagnifyingGlassIcon size={14} />
        Search plugins…
      </div>
    </div>
  );
}

export type InstalledPlugin = {
  name: string;
  version: string;
  description: string;
  permissions: string[];
  bookAccess: boolean;
};

export function PluginRow({ plugin, on }: { plugin: InstalledPlugin; on: number }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "18px 0", borderBottom: `1px solid ${color.border}` }}>
      <div style={{ width: 252, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{plugin.name}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: color.fgSubtle }}>v{plugin.version}</span>
          <Badge>Built-in</Badge>
        </div>
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, color: color.fgMuted }}>{plugin.description}</div>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {plugin.permissions.map((permission) => (
            <Badge key={permission} tall>
              {permission}
            </Badge>
          ))}
        </div>
        {plugin.bookAccess && (
          <div style={{ marginTop: 10, fontSize: 12, color: color.fgSubtle }}>Current grant: All books</div>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "flex-start", gap: 4 }}>
        {plugin.bookAccess && (
          <span
            style={{
              height: 32,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              fontSize: 14,
              fontWeight: 500,
              color: color.fgMuted,
              whiteSpace: "nowrap",
            }}
          >
            Change book access
          </span>
        )}
        <div style={{ height: 32, display: "flex", alignItems: "center" }}>
          <Switch on={on} />
        </div>
      </div>
    </div>
  );
}

function Badge({ children, tall = false }: { children: ReactNode; tall?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: tall ? 24 : 19,
        padding: "0 8px",
        fontSize: 11,
        fontWeight: 500,
        background: color.fillStrong,
        color: color.fgMuted,
      }}
    >
      {children}
    </span>
  );
}

/** packages/ui Toggle: h-5 w-9, a 14 px knob from 3 px to 18 px; `on` is 0..1. */
export function Switch({ on }: { on: number }) {
  return (
    <div
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: 20,
        flexShrink: 0,
        background: interpolateColors(on, [0, 1], [color.fillStrong, color.fg]),
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: mix(3, 18, on),
          width: 14,
          height: 14,
          borderRadius: 14,
          background: interpolateColors(on, [0, 1], ["#ffffff", color.inverseFg]),
          boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
        }}
      />
    </div>
  );
}
