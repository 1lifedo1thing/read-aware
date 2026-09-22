import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  distanceBetween, holdMenuItemAt, pointInReaderRoot, resolveHoldRelease,
  HOLD_MENU_MOVE_TOLERANCE_PX, HOLD_MENU_PRESS_MS, type HoldMenuPoint,
} from "../lib/hold-menu";

export type HoldMenuState = {
  /** Where the menu is anchored, in reader-root coordinates; null = closed. */
  anchor: HoldMenuPoint | null;
  /** The finger that opened the menu is still down and choosing. */
  sliding: boolean;
  /** The action under the sliding finger. */
  hovered: number | null;
  /** The second tier is showing. */
  moreOpen: boolean;
};

const CLOSED: HoldMenuState = { anchor: null, sliding: false, hovered: null, moreOpen: false };

/** Selection and the platform callout are suspended in the section documents
 *  while the hold gesture owns a long press. */
const SUPPRESSION_STYLE = "html, body { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }";
const STYLE_MARKER = "data-ra-hold-menu";

/**
 * The touch reader's hold menu, driven from the section documents' pointer
 * streams. The hook owns the gesture (press, open, slide, lift) and the open
 * state; `attach` wires a section document, `run` receives the chosen action's
 * index, and the component reports its action rects through `menuRef`.
 *
 * While enabled, the section documents give up native text selection and the
 * context-menu/callout: the long press belongs to the menu.
 */
export function useReaderHoldMenu({ enabled, readerRootRef, menuRef, liveDocuments, run, itemCount }: {
  enabled: boolean;
  readerRootRef: RefObject<HTMLElement | null>;
  /** The rendered menu row; its `[data-hold-item]` children are the actions. */
  menuRef: RefObject<HTMLElement | null>;
  /** The section documents currently rendered, for toggling suppression;
   *  documents are not retained here, so the engine may release them. */
  liveDocuments: () => Document[];
  run: (index: number) => void;
  /** Actions in the first tier, the last one being "more". */
  itemCount: number;
}) {
  const [state, setState] = useState<HoldMenuState>(CLOSED);
  const stateRef = useRef(state);
  stateRef.current = state;
  const enabledRef = useRef(enabled);
  const runRef = useRef(run);
  runRef.current = run;
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;
  const liveDocumentsRef = useRef(liveDocuments);
  liveDocumentsRef.current = liveDocuments;
  const swallowClickRef = useRef(false);

  const applySuppression = useCallback((doc: Document, on: boolean) => {
    const existing = doc.head?.querySelector(`style[${STYLE_MARKER}]`);
    if (on && !existing && doc.head) {
      const style = doc.createElement("style");
      style.setAttribute(STYLE_MARKER, "");
      style.textContent = SUPPRESSION_STYLE;
      doc.head.append(style);
    } else if (!on && existing) existing.remove();
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    for (const doc of liveDocumentsRef.current()) applySuppression(doc, enabled);
    if (!enabled) setState(CLOSED);
  }, [applySuppression, enabled]);

  const close = useCallback(() => setState(CLOSED), []);
  /** Open resting at a point (a tap on the resting unit's wash); the tap's own
   *  click has already been handled by then. */
  const openAt = useCallback((anchor: HoldMenuPoint) => {
    setState({ anchor, sliding: false, hovered: null, moreOpen: false });
  }, []);
  const openMore = useCallback(() => setState(current => current.anchor ? { ...current, sliding: false, hovered: null, moreOpen: true } : current), []);
  const setMoreOpen = useCallback((moreOpen: boolean) => setState(current => current.anchor ? { ...current, moreOpen } : current), []);
  /** The click a touch synthesizes after the gesture must not step the page. */
  const consumeClick = useCallback(() => {
    const swallow = swallowClickRef.current;
    swallowClickRef.current = false;
    return swallow;
  }, []);

  const actionRects = useCallback(() => {
    const root = readerRootRef.current, menu = menuRef.current;
    if (!root || !menu) return [];
    const rootRect = root.getBoundingClientRect();
    return Array.from(menu.querySelectorAll("[data-hold-item]"))
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left - rootRect.left, top: rect.top - rootRect.top, width: rect.width, height: rect.height };
      });
  }, [menuRef, readerRootRef]);

  const attach = useCallback((doc: Document): (() => void) => {
    applySuppression(doc, enabledRef.current);
    const controller = new AbortController();
    const { signal } = controller;
    const toRoot = (point: HoldMenuPoint): HoldMenuPoint | null => {
      const root = readerRootRef.current, frame = doc.defaultView?.frameElement;
      if (!root || !frame) return null;
      const frameRect = frame.getBoundingClientRect();
      const scale = frame.clientWidth && frameRect.width ? frameRect.width / frame.clientWidth : 1;
      return pointInReaderRoot(point, frameRect, root.getBoundingClientRect(), scale);
    };

    let pressTimer: number | null = null;
    let origin: HoldMenuPoint | null = null;
    let opened: HoldMenuPoint | null = null;
    // The touch that opened the menu belongs to it until it ends: the
    // paginator's swipe and the reader's touch stepping must not read the
    // slide as a page turn (touch events follow their pointer events, so this
    // outlives `opened`).
    let touchOwned = false;
    let travelled = 0;
    const cancelPress = () => {
      if (pressTimer != null) { window.clearTimeout(pressTimer); pressTimer = null; }
      origin = null;
    };

    doc.addEventListener("pointerdown", event => {
      // A new gesture: a click left unswallowed by the previous one (a slide
      // synthesizes none) must not eat this tap.
      swallowClickRef.current = false;
      if (!enabledRef.current || event.pointerType === "mouse" || !event.isPrimary) return;
      cancelPress();
      opened = null;
      origin = { x: event.clientX, y: event.clientY };
      const pressed = origin;
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        const anchor = toRoot(pressed);
        if (!anchor || !enabledRef.current) return;
        opened = pressed;
        touchOwned = true;
        travelled = 0;
        swallowClickRef.current = true;
        setState({ anchor, sliding: true, hovered: null, moreOpen: false });
      }, HOLD_MENU_PRESS_MS);
    }, { capture: true, signal });

    doc.addEventListener("pointermove", event => {
      const point = { x: event.clientX, y: event.clientY };
      if (opened) {
        travelled = Math.max(travelled, distanceBetween(opened, point));
        const rootPoint = toRoot(point);
        const hovered = rootPoint ? holdMenuItemAt(rootPoint, actionRects()) : null;
        setState(current => current.hovered === hovered ? current : { ...current, hovered });
        return;
      }
      if (origin && pressTimer != null && distanceBetween(origin, point) > HOLD_MENU_MOVE_TOLERANCE_PX) cancelPress();
    }, { capture: true, signal });

    const lift = (event: PointerEvent) => {
      cancelPress();
      if (!opened) return;
      opened = null;
      const point = { x: event.clientX, y: event.clientY };
      const rootPoint = toRoot(point);
      const hovered = rootPoint ? holdMenuItemAt(rootPoint, actionRects()) : null;
      const release = resolveHoldRelease({ hovered, travelled });
      if (release.kind === "run") {
        const isMore = release.index === itemCountRef.current - 1;
        setState(current => isMore ? { ...current, sliding: false, hovered: null, moreOpen: true } : CLOSED);
        if (!isMore) runRef.current(release.index);
      } else if (release.kind === "stay") setState(current => ({ ...current, sliding: false, hovered: null }));
      else setState(CLOSED);
    };
    doc.addEventListener("pointerup", lift, { capture: true, signal });
    // A cancelled pointer (the platform took the touch) ends a press; a menu
    // already open stays for taps rather than vanishing under the finger.
    doc.addEventListener("pointercancel", () => {
      cancelPress();
      if (opened) { opened = null; setState(current => ({ ...current, sliding: false, hovered: null })); }
    }, { capture: true, signal });

    // Once the menu is open the finger is choosing: neither scrolling the page
    // nor swiping it. Capture phase, ahead of the paginator's and the reader's
    // own touch handlers on this document.
    doc.addEventListener("touchmove", event => {
      if (!touchOwned) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false, signal });
    const releaseTouch = (event: TouchEvent) => {
      if (!touchOwned) return;
      touchOwned = false;
      event.stopImmediatePropagation();
    };
    doc.addEventListener("touchend", releaseTouch, { capture: true, signal });
    doc.addEventListener("touchcancel", releaseTouch, { capture: true, signal });
    // The long press is the menu's; the platform must not select or pop its callout.
    doc.addEventListener("contextmenu", event => { if (enabledRef.current) event.preventDefault(); }, { signal });
    doc.addEventListener("selectstart", event => { if (enabledRef.current) event.preventDefault(); }, { signal });

    return () => {
      controller.abort();
      cancelPress();
      applySuppression(doc, false);
    };
  }, [actionRects, applySuppression, readerRootRef]);

  return useMemo(() => ({
    state, attach, openAt, openMore, setMoreOpen, close, consumeClick,
    isOpen: () => stateRef.current.anchor !== null,
  }), [attach, close, consumeClick, openAt, openMore, setMoreOpen, state]);
}
