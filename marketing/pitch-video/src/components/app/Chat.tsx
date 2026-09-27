import { ArrowUpIcon, CaretRightIcon, CheckIcon, ImageIcon, QuotesIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { Img, staticFile } from "remotion";
import { color, font, shadow } from "../../theme";

/**
 * Chat surfaces, restated from apps/web/src/features/ai/components:
 * ChatMessageItem, AttachmentChip, ChatToolStep / ChatActivity, the
 * BookReferenceCard and WordReferenceCard references, and ChatComposer.
 * Chat content uses the content typography default: Inter, 14 px, 1.65.
 */

const content: CSSProperties = { fontFamily: font.sans, fontSize: 14, lineHeight: 1.65, color: color.fg };

/** A quoted passage pulled in with "Ask AI about this". */
export function AttachmentChip({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 6,
        background: "rgba(231, 229, 228, 0.55)",
        ...style,
      }}
    >
      <QuotesIcon size={12} weight="fill" color={color.fgSubtle} style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: font.sans, fontSize: 12, lineHeight: 1.35, color: color.fgMuted }}>{text}</span>
    </div>
  );
}

export function UserTurn({ passage, text, style }: { passage?: string; text: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, ...style }}>
      {passage && <AttachmentChip text={passage} style={{ maxWidth: "90%" }} />}
      <div style={{ ...content, maxWidth: "90%", borderRadius: 8, background: color.fillStrong, padding: "8px 12px" }}>
        {text}
      </div>
    </div>
  );
}

export function Spinner({ frame, size = 12 }: { frame: number; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        margin: "0 2px",
        borderRadius: size,
        border: `1.5px solid ${color.fillStrong}`,
        borderTopColor: color.fgMuted,
        transform: `rotate(${frame * 24}deg)`,
        flexShrink: 0,
      }}
    />
  );
}

/** One tool step: a spinner while it runs, then a check. */
export function ToolStep({ label, running, frame }: { label: string; running: boolean; frame: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontFamily: font.sans,
        fontSize: 12,
        color: running ? color.fgMuted : color.fgSubtle,
      }}
    >
      {running ? <Spinner frame={frame} /> : <CheckIcon size={12} color={color.fgSubtle} />}
      <span>{label}</span>
    </div>
  );
}

/** ChatActivity, collapsed: "› 2 tool calls". */
export function ToolActivity({ summary }: { summary: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontFamily: font.sans,
        fontSize: 12,
        color: color.fgSubtle,
      }}
    >
      <CaretRightIcon size={12} />
      <span>{summary}</span>
    </div>
  );
}

/** Assistant text as it streams, with the chat caret while incomplete. */
export function StreamedText({ text, done }: { text: string; done: boolean }) {
  return (
    <div style={content}>
      {text}
      {!done && (
        <span
          style={{
            display: "inline-block",
            width: 7,
            height: 14,
            marginLeft: 2,
            verticalAlign: "-2px",
            borderRadius: 1,
            background: color.fg,
            opacity: 0.7,
          }}
        />
      )}
    </div>
  );
}

export function BookReferenceCard({
  cover,
  title,
  author,
  progress,
  style,
}: {
  cover: string;
  title: string;
  author: string;
  /** 0..100, reading progress. */
  progress?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 10px",
        borderRadius: 6,
        boxShadow: `inset 0 0 0 1px ${color.border}`,
        ...style,
      }}
    >
      <div
        style={{ width: 44, height: 64, borderRadius: 2, overflow: "hidden", boxShadow: shadow.cover, flexShrink: 0 }}
      >
        <Img src={staticFile(cover)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: font.appSerif, fontSize: 14, fontWeight: 500, color: color.fg }}>{title}</div>
        <div style={{ marginTop: 2, fontFamily: font.sans, fontSize: 12, color: color.fgMuted }}>{author}</div>
        {progress !== undefined && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 96, height: 4, borderRadius: 4, background: color.fillStrong, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: color.fg }} />
            </div>
            <span
              style={{ fontFamily: font.sans, fontSize: 11, color: color.fgMuted, fontVariantNumeric: "tabular-nums" }}
            >
              {progress}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function WordReferenceCard({
  term,
  pronunciation,
  partOfSpeech,
  definition,
  example,
  style,
}: {
  term: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  example: string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 6, boxShadow: `inset 0 0 0 1px ${color.border}`, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: font.appSerif, fontSize: 16, fontWeight: 500, color: color.fg }}>{term}</span>
        <span style={{ fontFamily: font.sans, fontSize: 12, color: color.fgSubtle }}>{pronunciation}</span>
      </div>
      <div style={{ marginTop: 6, fontFamily: font.sans, fontSize: 12, lineHeight: 1.625, color: color.fg }}>
        <span style={{ fontFamily: font.appSerif, fontStyle: "italic", color: color.fgMuted }}>{partOfSpeech} · </span>
        {definition}
      </div>
      <div
        style={{
          marginTop: 4,
          paddingLeft: 12,
          fontFamily: font.appSerif,
          fontStyle: "italic",
          fontSize: 12,
          lineHeight: 1.625,
          color: color.fgSubtle,
        }}
      >
        {example}
      </div>
    </div>
  );
}

/** ChatComposer: bare textarea over a hairline, image and send buttons at the right. */
export function Composer({
  placeholder,
  value = "",
  chip,
  maxWidth,
  caret = false,
}: {
  placeholder: string;
  value?: string;
  chip?: ReactNode;
  /** The transcript measure on the wide Agent page. */
  maxWidth?: number;
  caret?: boolean;
}) {
  return (
    <div style={{ borderTop: `1px solid ${color.border}`, padding: 12, background: color.paper }}>
      <div style={{ margin: "0 auto", maxWidth }}>
        {chip && <div style={{ marginBottom: 8 }}>{chip}</div>}
        <div style={{ position: "relative", minHeight: 32, display: "flex", alignItems: "center" }}>
          <span style={{ ...content, color: value ? color.fg : color.fgSubtle, paddingRight: 64 }}>
            {value || placeholder}
            {caret && (
              <span
                style={{
                  display: "inline-block",
                  width: 1.5,
                  height: 17,
                  marginLeft: 1,
                  verticalAlign: "-3px",
                  background: color.fg,
                }}
              />
            )}
          </span>
          <ImageIcon size={16} color={color.fgMuted} style={{ position: "absolute", right: 36, bottom: 8 }} />
          <div
            style={{
              position: "absolute",
              right: 4,
              bottom: 4,
              width: 24,
              height: 24,
              borderRadius: 6,
              display: "grid",
              placeItems: "center",
              background: value ? color.fg : "transparent",
            }}
          >
            <ArrowUpIcon size={14} color={value ? color.inverseFg : color.fgSubtle} />
          </div>
        </div>
      </div>
    </div>
  );
}
