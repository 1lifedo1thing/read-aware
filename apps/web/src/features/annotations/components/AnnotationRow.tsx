import { useRef } from "react";
import { ChatCircleDots, NotePencil, Trash } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, useTranslation } from "../../../i18n";
import { UNDERLINE_STROKE } from "../../reader/lib/highlight-renderer";
import { useSwipeReveal } from "../hooks/useSwipeReveal";
import type { Annotation } from "../lib/annotation-types";

/** How far a row slides open on touch, uncovering its delete action. */
const DELETE_REVEAL_PX = 80;

function formatTimestamp(iso: string): string {
  return formatDate(new Date(iso), { month: "short", day: "numeric" });
}

/**
 * One annotation in a list: a rule in its highlight color beside the quoted
 * passage, any note beneath it, and the date. Tapping it navigates to the
 * passage.
 *
 * Set in the app's own type, not the reading typography: a list of excerpts
 * is for scanning back through, and at a book's face and size it reads as a
 * stack of paragraphs instead.
 *
 * Deleting is a hover trash control for a mouse. On touch the row swipes left
 * to uncover a Delete action instead of showing a trash can on every row; the
 * control stays in the accessibility tree there, for a screen reader that
 * cannot swipe.
 */
export function AnnotationRow({
  annotation,
  onNavigate,
  onDelete,
}: {
  annotation: Annotation;
  onNavigate: (cfiRange: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation("ai");
  const rowRef = useRef<HTMLDivElement | null>(null);
  const reveal = useSwipeReveal(rowRef, DELETE_REVEAL_PX);
  const rule = annotation.type === "highlight" ? UNDERLINE_STROKE[annotation.color] : undefined;

  return (
    <div ref={rowRef} className="relative overflow-hidden rounded-md">
      {reveal.offset < 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onDelete(annotation.id)}
          style={{ width: -reveal.offset }}
          className="absolute inset-y-0 right-0 flex items-center justify-center overflow-hidden bg-red-700 font-sans text-[13px] font-medium text-white"
        >
          <span className="px-2">{t("annotation.delete")}</span>
        </button>
      )}
      <div
        style={{ transform: reveal.offset ? `translateX(${reveal.offset}px)` : undefined }}
        className={cn(
          "group flex items-start gap-1 rounded-md transition-colors hover:bg-fg/5",
          !reveal.dragging && "transition-[transform,background-color] duration-200 ease-out",
        )}
      >
        <button
          type="button"
          onClick={() => {
            // A tap on an open row closes it rather than leaving the list.
            if (reveal.offset) reveal.close();
            else if (annotation.cfiRange) onNavigate(annotation.cfiRange);
          }}
          className="flex min-w-0 flex-1 gap-3 rounded-md py-2 pl-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
        >
          <span
            aria-hidden="true"
            className={cn("w-[3px] shrink-0 self-stretch rounded-full", !rule && "bg-border-strong")}
            style={rule ? { backgroundColor: rule } : undefined}
          />
          <div className="min-w-0 flex-1 font-sans">
            {annotation.type === "ask" ? (
              // ask = 提问痕迹：text 是问题本身，不加引号（不是书里的原文）
              <p className="flex gap-1.5 text-[13px] leading-relaxed text-fg">
                <ChatCircleDots size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-fg-subtle" />
                <span className="line-clamp-3">{annotation.text}</span>
              </p>
            ) : (
              <p className="line-clamp-3 text-[13px] leading-relaxed text-fg">&ldquo;{annotation.text}&rdquo;</p>
            )}
            {annotation.type === "note" && (
              <p className="mt-1 flex gap-1.5 text-[13px] leading-relaxed text-fg-muted">
                <NotePencil size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-fg-subtle" />
                <span className="line-clamp-3">{annotation.content}</span>
              </p>
            )}
            <p className="mt-1 text-[11px] text-fg-subtle">{formatTimestamp(annotation.createdAt)}</p>
          </div>
        </button>
        <IconButton
          label={t("annotation.delete")}
          size="sm"
          onClick={() => onDelete(annotation.id)}
          className="mt-1 shrink-0 text-fg-subtle opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:sr-only"
          icon={<Trash size={12} weight="regular" />}
        />
      </div>
    </div>
  );
}
