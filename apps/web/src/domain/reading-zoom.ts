/**
 * The per-book zoom of fixed-layout books (PDF, comics): a fit and a factor
 * over it (see `foliate-js/src/fixed-zoom.ts`), remembered for each book.
 *
 * Device-local: a zoom answers to this screen and window, so it does not roam
 * with the library. Keyed by library book id; a book never zoomed has no entry
 * and opens at the default. Writes go through the KV queue, which publishes
 * them optimistically and rolls back — with `local-write-failed` — on failure.
 */
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  normalizeFixedLayoutZoom,
  sameFixedLayoutZoom,
  type FixedLayoutZoom,
} from "../../foliate-js/src/fixed-zoom";
import { localKV } from "../platform/local-store";
import type { DomainActor } from "../platform/domain-actor";

export const FIXED_LAYOUT_ZOOM_KEY = "read-aware-fixed-layout-zoom";
export type FixedLayoutZooms = Record<string, FixedLayoutZoom>;

export function getFixedLayoutZooms(): FixedLayoutZooms {
  try {
    const parsed: unknown = JSON.parse(localKV.getItem(FIXED_LAYOUT_ZOOM_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, zoom]) => [id, normalizeFixedLayoutZoom(zoom)]));
  } catch {
    return {}; // A lost zoom only reopens the book at its default fit.
  }
}

export function saveFixedLayoutZoom(bookId: string, zoom: FixedLayoutZoom, origin: DomainActor): void {
  const zooms = getFixedLayoutZooms();
  const current = zooms[bookId] ?? DEFAULT_FIXED_LAYOUT_ZOOM;
  if (sameFixedLayoutZoom(current, zoom)) return;
  const next = { ...zooms };
  // The default needs no entry.
  if (sameFixedLayoutZoom(zoom, DEFAULT_FIXED_LAYOUT_ZOOM)) delete next[bookId];
  else next[bookId] = zoom;
  localKV.setItem(FIXED_LAYOUT_ZOOM_KEY, JSON.stringify(next), "local", origin);
}
