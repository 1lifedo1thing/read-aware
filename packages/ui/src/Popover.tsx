import { useRef, useEffect, useId, useCallback, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";
import { useHorizontalViewportCollision } from "./lib/useHorizontalViewportCollision";
import { Tooltip } from "./Tooltip";

type PopoverProps = {
  trigger: ReactNode;
  /** Accessible name for the (otherwise unlabeled) trigger button. */
  triggerLabel?: string;
  triggerDisabled?: boolean;
  triggerPressed?: boolean;
  /** Visible hover/focus tooltip for the trigger, matching the icon buttons in
   *  the same cluster. Wraps only the button, so the open panel doesn't trip it. */
  triggerTooltip?: string;
  /** Which side the trigger tooltip appears on (default "bottom"). */
  triggerTooltipSide?: "top" | "bottom" | "left" | "right";
  /** Horizontal alignment of the trigger tooltip (default "center"); use "end"
   *  for triggers at the window's right edge so the tooltip stays inside. */
  triggerTooltipAlign?: "start" | "center" | "end";
  /** Override the trigger button styling (defaults to a bare inline-flex). */
  triggerClassName?: string;
  children: ReactNode;
  align?: "left" | "right" | "center";
  /**
   * Which side of the trigger the panel opens on (default "bottom"). "top"
   * serves triggers docked at the bottom of the screen, such as a phone's
   * bottom toolbar; the panel's height is then capped to the space above.
   */
  side?: "bottom" | "top";
  className?: string;
  /** Extra classes for the floating panel itself (the `role="dialog"` element),
   *  as opposed to `className` which styles the inline-block trigger wrapper.
   *  Use this to make the panel the scroll container so its scrollbar sits at the
   *  panel edge rather than on an inset child. */
  panelClassName?: string;
  /** Controlled open state. Omit for uncontrolled (self-managed) behavior. */
  open?: boolean;
  /** Notified whenever the open state should change (both modes). */
  onOpenChange?: (open: boolean) => void;
};

export function Popover({
  trigger,
  triggerLabel,
  triggerDisabled,
  triggerPressed,
  triggerTooltip,
  triggerTooltipSide = "bottom",
  triggerTooltipAlign = "center",
  triggerClassName,
  children,
  align = "left",
  side = "bottom",
  className,
  panelClassName,
  open: openProp,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useLocalAtom(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;

  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const { floatingRef, positionStyle } = useHorizontalViewportCollision(open, align);
  const spaceAbove = useSpaceAbove(open && side === "top", containerRef);

  const setOpen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(open) : next;
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange, open, setInternalOpen],
  );

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      // Clicks inside body-portaled floating UI (e.g. a Select listbox opened
      // from within this popover) are logically inside, not a dismissal.
      if (target instanceof Element && target.closest("[data-ui-portal]")) return;
      setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, setOpen]);

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={triggerLabel}
      disabled={triggerDisabled}
      aria-pressed={triggerPressed}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => setOpen((o) => !o)}
      className={cn("inline-flex disabled:cursor-default disabled:opacity-50", triggerClassName)}
    >
      {trigger}
    </button>
  );

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      {triggerTooltip ? (
        <Tooltip content={triggerTooltip} side={triggerTooltipSide} align={triggerTooltipAlign}>
          {triggerButton}
        </Tooltip>
      ) : (
        triggerButton
      )}
      {open && (
        <div
          ref={floatingRef}
          style={spaceAbove === null ? positionStyle : { ...positionStyle, "--ra-popover-space": `${spaceAbove}px` } as CSSProperties}
          className={cn(
            "absolute z-50 w-max max-w-[calc(100vw-1rem)]",
            side === "top" ? "bottom-full mb-2" : "mt-2",
            align === "center" && "-translate-x-1/2",
          )}
        >
          <div
            id={panelId}
            role="dialog"
            className={cn(
              "min-w-[200px] max-w-full overflow-y-auto rounded-md border border-border bg-[var(--ra-main-surface-color)] p-4",
              side === "top"
                ? "ra-motion-overlay-pop-up max-h-[var(--ra-popover-space,calc(100dvh-3.5rem))]"
                : "ra-motion-overlay-pop max-h-[calc(100dvh-3.5rem)]",
              side === "top"
                ? align === "left" ? "origin-bottom-left" : align === "right" ? "origin-bottom-right" : "origin-bottom"
                : align === "left" ? "origin-top-left" : align === "right" ? "origin-top-right" : "origin-top",
              panelClassName,
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/** Viewport margin kept free above an upward panel. */
const SPACE_ABOVE_GAP = 8;

/**
 * Height available above the trigger for an upward panel, re-measured while
 * open as the viewport changes (rotation, on-screen keyboard). Null when the
 * panel is closed or opens downward.
 */
function useSpaceAbove(active: boolean, anchorRef: RefObject<HTMLDivElement | null>): number | null {
  const [space, setSpace] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      setSpace(null);
      return;
    }
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      // The panel sits 0.5rem (mb-2) above the trigger.
      const next = Math.max(0, Math.floor(anchor.getBoundingClientRect().top - viewportTop - 8 - SPACE_ABOVE_GAP));
      setSpace((current) => (current === next ? current : next));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [active, anchorRef]);
  return space;
}
