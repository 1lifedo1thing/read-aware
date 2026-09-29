/**
 * How each fixed-layout book (PDF, comics) was last viewed on this device:
 * its zoom — a fit and a factor over it (see `foliate-js/src/fixed-zoom.ts`)
 * — and where on the page being read the viewport's center rested
 * (`FixedLayout.viewFocus`). The reading position itself names only the page
 * and roams with the library; this is the rest of the view, which answers to
 * this screen and window and so stays on this device.
 *
 * Keyed by library book id; a book viewed only at the default, from a page's
 * start, has no entry. Writes go through the KV queue, which publishes them
 * optimistically and rolls back — with `local-write-failed` — on failure.
 */
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  normalizeFixedLayoutZoom,
  sameFixedLayoutZoom,
  type FixedLayoutZoom,
} from "../../foliate-js/src/fixed-zoom";
import type { ViewFocus } from "../../foliate-js/src/fixed-layout";
import { localKV } from "../platform/local-store";
import type { DomainActor } from "../platform/domain-actor";

export const FIXED_LAYOUT_ZOOM_KEY = "read-aware-fixed-layout-zoom";
export type FixedLayoutView = FixedLayoutZoom & { focus?: ViewFocus };
export type FixedLayoutViews = Record<string, FixedLayoutView>;

function normalizeFocus(value: unknown): ViewFocus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { index, x, y } = value as Partial<Record<keyof ViewFocus, unknown>>;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return { index, x, y };
}

function normalizeView(value: unknown): FixedLayoutView {
  const zoom = normalizeFixedLayoutZoom(value);
  const focus = normalizeFocus((value as { focus?: unknown } | null)?.focus);
  return focus ? { ...zoom, focus } : zoom;
}

export function getFixedLayoutViews(): FixedLayoutViews {
  try {
    const parsed: unknown = JSON.parse(localKV.getItem(FIXED_LAYOUT_ZOOM_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, view]) => [id, normalizeView(view)]));
  } catch {
    return {}; // A lost view only reopens the book at its default fit, from the page's start.
  }
}

function saveView(bookId: string, view: FixedLayoutView, origin: DomainActor) {
  const views = getFixedLayoutViews();
  const next = { ...views };
  // A default zoom with no place to return to needs no entry.
  if (sameFixedLayoutZoom(view, DEFAULT_FIXED_LAYOUT_ZOOM) && !view.focus) delete next[bookId];
  else next[bookId] = view;
  if (JSON.stringify(next[bookId]) === JSON.stringify(views[bookId])) return;
  localKV.setItem(FIXED_LAYOUT_ZOOM_KEY, JSON.stringify(next), "local", origin);
}

/** Remember a book's zoom, keeping where it was being read. */
export function saveFixedLayoutZoom(bookId: string, zoom: FixedLayoutZoom, origin: DomainActor): void {
  const focus = getFixedLayoutViews()[bookId]?.focus;
  saveView(bookId, { fit: zoom.fit, factor: zoom.factor, ...(focus ? { focus } : {}) }, origin);
}

/** Remember where on its page a book was being read, keeping its zoom. */
export function saveFixedLayoutFocus(bookId: string, focus: ViewFocus, origin: DomainActor): void {
  const view = getFixedLayoutViews()[bookId] ?? DEFAULT_FIXED_LAYOUT_ZOOM;
  saveView(bookId, { fit: view.fit, factor: view.factor, focus: normalizeFocus(focus) }, origin);
}
