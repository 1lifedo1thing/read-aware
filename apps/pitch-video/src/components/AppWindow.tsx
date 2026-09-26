import {
  ChartLineUpIcon,
  DotsThreeVerticalIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { color, font, windowShadow } from "../theme";

/**
 * The desktop app's window, drawn as a still frame for the film.
 *
 * This deliberately does not mount @read-aware/ui: the shared controls carry
 * CSS transitions and interaction state, and a video frame must be a pure
 * function of the frame number. The chrome below restates only the shell's
 * visible surface — stone tokens, the centred "Library / Agent" breadcrumb and
 * the icon row — with the same Phosphor icons the app uses.
 */
export function AppWindow({
  width,
  height,
  children,
  topBar = "library",
  background = color.paper,
  elevation = 1,
  style,
}: {
  width: number;
  height: number;
  children: ReactNode;
  topBar?: "library" | "agent" | "none";
  background?: string;
  /** 0..1 strength of the window's shadow and hairline. */
  elevation?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        width,
        height,
        borderRadius: 14,
        overflow: "hidden",
        background,
        boxShadow: windowShadow(elevation),
        ...style,
      }}
    >
      {topBar !== "none" && <TopBar active={topBar} />}
      <div
        style={{
          position: "absolute",
          inset: 0,
          top: topBar === "none" ? 0 : TOP_BAR_HEIGHT,
        }}
      >
        {children}
      </div>
      <TrafficLights opacity={elevation} />
    </div>
  );
}

export const TOP_BAR_HEIGHT = 58;

function TrafficLights({ opacity }: { opacity: number }) {
  return (
    <div style={{ position: "absolute", top: 21, left: 22, display: "flex", gap: 9, opacity }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((fill) => (
        <div
          key={fill}
          style={{
            width: 13,
            height: 13,
            borderRadius: 99,
            background: fill,
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)",
          }}
        />
      ))}
    </div>
  );
}

function TopBar({ active }: { active: "library" | "agent" }) {
  const crumb = (label: string, on: boolean) => (
    <span style={{ color: on ? color.fg : color.fgSubtle, fontWeight: on ? 500 : 400 }}>
      {label}
    </span>
  );
  const icons = [
    MagnifyingGlassIcon,
    PlusIcon,
    SlidersHorizontalIcon,
    ChartLineUpIcon,
    GearSixIcon,
    DotsThreeVerticalIcon,
  ];
  return (
    <div
      style={{
        position: "absolute",
        insetInline: 0,
        top: 0,
        height: TOP_BAR_HEIGHT,
        borderBottom: `1px solid ${color.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: font.sans,
        fontSize: 19,
        gap: 14,
      }}
    >
      {crumb("Library", active === "library")}
      <span style={{ color: color.borderStrong }}>/</span>
      {crumb("Agent", active === "agent")}
      <div style={{ position: "absolute", right: 24, display: "flex", gap: 22, color: color.fgMuted }}>
        {icons.map((Icon, i) => (
          <Icon key={i} size={22} />
        ))}
      </div>
    </div>
  );
}
