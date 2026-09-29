import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { fixedLayoutViewsAtom } from "../../../state/ui";
import type { DomainActor } from "../../../platform/domain-actor";
import { saveFixedLayoutZoom } from "../../../domain/reading-zoom";
import { DEFAULT_FIXED_LAYOUT_ZOOM, type FixedLayoutFit, type FixedLayoutZoom } from "../lib/fixed-layout-zoom";

export type FixedLayoutZoomSetting = {
  /** The book's remembered zoom. */
  zoom: FixedLayoutZoom;
  /** Change what 100% means; the factor returns to it. */
  setFit: (fit: FixedLayoutFit, origin?: DomainActor) => void;
};

/**
 * A book's fixed-layout zoom, as the fit control sees it: read from and written to
 * the per-book memory. The open reader applies every change to its pages
 * (see `useFixedLayoutZoom`), wherever the change was made.
 */
export function useFixedLayoutZoomSetting(bookId: string): FixedLayoutZoomSetting {
  const zoom = useAtomValue(fixedLayoutViewsAtom)[bookId] ?? DEFAULT_FIXED_LAYOUT_ZOOM;
  const setFit = useCallback(
    (fit: FixedLayoutFit, origin: DomainActor = "user") => saveFixedLayoutZoom(bookId, { fit, factor: 1 }, origin),
    [bookId],
  );
  return { zoom, setFit };
}
