import {
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  ChatCircleIcon,
  CopyIcon,
  CrosshairIcon,
  DotsThreeVerticalIcon,
  HighlighterIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  NotebookIcon,
  NotePencilIcon,
  ParagraphIcon,
  SpeakerHighIcon,
  TextAaIcon,
  TextUnderlineIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { color, font, shadow } from "../../theme";

/**
 * Reader chrome, restated from apps/web/src/features/reader: the desktop
 * reader header (ReaderShellOverlay), the sentence-mode TextUnitNavigatorBar
 * and TextUnitReadoutChip, and ReaderSelectionMenu.
 */

const iconButton = (IconC: Icon, size: number, active = false, key?: number) => (
  <div
    key={key}
    style={{
      width: 28,
      height: 28,
      display: "grid",
      placeItems: "center",
      borderRadius: 6,
      color: active ? color.fg : color.fgMuted,
    }}
  >
    <IconC size={size} weight={active ? "bold" : "regular"} />
  </div>
);

/** The reader's header when its controls are showing, with the progress hairline. */
export function ReaderTopBar({
  title,
  detail,
  progress,
  chatActive = 0,
  style,
}: {
  title: string;
  detail: string;
  /** 0..1 through the book. */
  progress: number;
  /** 0..1, the chat button's active state. */
  chatActive?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        insetInline: 0,
        top: 0,
        height: 48,
        background: color.page,
        fontFamily: font.sans,
        ...style,
      }}
    >
      <div style={{ position: "absolute", left: 80, top: 10, display: "flex", gap: 2 }}>
        {iconButton(CaretLeftIcon, 18, false, 0)}
        {iconButton(ListBulletsIcon, 16, false, 1)}
        {iconButton(NotebookIcon, 16, false, 2)}
      </div>
      <div style={{ position: "absolute", insetInline: 0, top: 8, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: "18px", color: color.fg }}>{title}</div>
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            lineHeight: "12px",
            color: color.fgSubtle,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {detail}
        </div>
      </div>
      <div style={{ position: "absolute", right: 16, top: 10, display: "flex", gap: 2 }}>
        {iconButton(ParagraphIcon, 16, false, 0)}
        {iconButton(TextAaIcon, 16, false, 1)}
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, opacity: 1 - chatActive }}>
            {iconButton(ChatCircleIcon, 16)}
          </div>
          <div style={{ opacity: chatActive }}>{iconButton(ChatCircleIcon, 16, true)}</div>
        </div>
        {iconButton(MagnifyingGlassIcon, 16, false, 3)}
        {iconButton(DotsThreeVerticalIcon, 16, false, 4)}
      </div>
      <div
        style={{ position: "absolute", insetInline: 0, bottom: 0, height: 1, background: color.pageRule, opacity: 0.6 }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 2,
          width: `${progress * 100}%`,
          background: color.fgSubtle,
        }}
      />
    </div>
  );
}

/** TextUnitNavigatorBar: the floating step bar while reading by sentence. */
export function NavigatorBar({ style }: { style?: CSSProperties }) {
  const groups: [Icon, number][][] = [
    [
      [CaretLeftIcon, 16],
      [CaretRightIcon, 16],
      [SpeakerHighIcon, 15],
    ],
    [
      [CrosshairIcon, 14],
      [ParagraphIcon, 14],
    ],
    [
      [ListBulletsIcon, 14],
      [NotebookIcon, 14],
      [TextAaIcon, 14],
      [ChatCircleIcon, 14],
    ],
    [[XIcon, 14]],
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 38,
        padding: "0 4px",
        borderRadius: 8,
        background: color.paper,
        boxShadow: `0 0 0 1px ${color.border}, ${shadow.float}`,
        ...style,
      }}
    >
      {groups.map((group, g) => (
        <div key={g} style={{ display: "flex", alignItems: "center" }}>
          {g > 0 && <div style={{ width: 1, height: 18, background: color.border, margin: "0 6px" }} />}
          {group.map(([IconC, size], i) => iconButton(IconC, size, false, i))}
        </div>
      ))}
    </div>
  );
}

/** TextUnitReadoutChip: sentence position and session time. */
export function ReadoutChip({
  position,
  total,
  time,
  style,
}: {
  position: number;
  total: number;
  time: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 10px",
        borderRadius: 6,
        background: color.paper,
        boxShadow: `0 0 0 1px ${color.border}`,
        fontFamily: font.sans,
        fontSize: 12,
        color: color.fgMuted,
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      <span>
        {position} / {total}
      </span>
      <span style={{ width: 1, height: 12, background: color.border }} />
      <span>{time}</span>
    </div>
  );
}

/** ReaderSelectionMenu: icon actions over a selection; `hot` lights the Ask AI button. */
export function SelectionMenu({ hot = 0 }: { hot?: number }) {
  const items: Icon[] = [
    CopyIcon,
    HighlighterIcon,
    TextUnderlineIcon,
    NotePencilIcon,
    ChatCircleDotsIcon,
    DotsThreeVerticalIcon,
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 4,
        borderRadius: 8,
        background: color.paper,
        boxShadow: `0 0 0 1px ${color.border}, ${shadow.float}`,
        color: color.fg,
      }}
    >
      {items.map((IconC, i) => (
        <div
          key={i}
          style={{
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            borderRadius: 6,
            background: i === 4 ? `rgba(28,25,23,${(0.07 * hot).toFixed(3)})` : "transparent",
          }}
        >
          <IconC size={16} />
        </div>
      ))}
    </div>
  );
}

/** Offset of the Ask AI button's centre from the menu's left edge. */
export const SELECTION_MENU_ASK_X = 4 + 4 * 30 + 14;
export const SELECTION_MENU_WIDTH = 4 * 2 + 6 * 28 + 5 * 2;
