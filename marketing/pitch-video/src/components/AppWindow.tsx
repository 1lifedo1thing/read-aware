import {
  ChartLineUpIcon,
  ChatsIcon,
  DotsThreeVerticalIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  NotebookIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { WINDOW } from "./Camera";
import { color, font, windowShadow } from "../theme";

/**
 * The desktop app's window, drawn as a still frame for the film, at the app's
 * logical size (see Camera).
 *
 * This deliberately does not mount apps/web or @read-aware/ui: those controls
 * carry CSS transitions and interaction state, and a video frame must be a
 * pure function of the frame number. The pieces under components/app restate
 * the product's visible surface from its source classes — same tokens, sizes
 * and Phosphor icons — so they read as the real app.
 */
export function AppWindow({
  children,
  header,
  background = color.paper,
  elevation = 1,
}: {
  children: ReactNode;
  /** The shell header, or none when the reader owns the whole window. */
  header?: "library" | "agent";
  background?: string;
  /** 0..1 strength of the window's shadow, hairline and traffic lights. */
  elevation?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        width: WINDOW.w,
        height: WINDOW.h,
        borderRadius: 11,
        overflow: "hidden",
        background,
        boxShadow: windowShadow(elevation),
        fontFamily: font.sans,
        color: color.fg,
      }}
    >
      {header && <AppHeader active={header} />}
      <div style={{ position: "absolute", inset: 0, top: header ? HEADER_HEIGHT : 0 }}>{children}</div>
      <TrafficLights opacity={elevation} />
    </div>
  );
}

export const HEADER_HEIGHT = 48;

function TrafficLights({ opacity }: { opacity: number }) {
  return (
    <div style={{ position: "absolute", top: 18, left: 18, display: "flex", gap: 8, opacity }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((fill) => (
        <div
          key={fill}
          style={{
            width: 12,
            height: 12,
            borderRadius: 12,
            background: fill,
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)",
          }}
        />
      ))}
    </div>
  );
}

/** AppHeader: h-12, the centred Library / Agent destinations and the utility icons. */
function AppHeader({ active }: { active: "library" | "agent" }) {
  const crumb = (label: string, on: boolean) => (
    <span style={{ color: on ? color.fg : color.fgSubtle, fontWeight: 500 }}>{label}</span>
  );
  const icons =
    active === "library"
      ? [MagnifyingGlassIcon, PlusIcon, SlidersHorizontalIcon, ChartLineUpIcon, GearSixIcon, DotsThreeVerticalIcon]
      : [PlusIcon, ChatsIcon, NotebookIcon];
  return (
    <div
      style={{
        position: "absolute",
        insetInline: 0,
        top: 0,
        height: HEADER_HEIGHT,
        borderBottom: `1px solid ${color.border}`,
        background: color.paper,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        gap: 12,
      }}
    >
      {crumb("Library", active === "library")}
      <span style={{ color: "rgba(168,162,158,0.5)" }}>/</span>
      {crumb("Agent", active === "agent")}
      <div style={{ position: "absolute", right: 18, display: "flex", gap: 18, color: color.fgMuted }}>
        {icons.map((Icon, i) => (
          <Icon key={i} size={16} />
        ))}
      </div>
    </div>
  );
}
