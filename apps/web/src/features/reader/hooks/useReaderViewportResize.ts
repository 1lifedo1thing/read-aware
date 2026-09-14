import { useEffect, type RefObject } from "react";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";
import { createLogger } from "../../../platform/logger";
import type { FoliateView } from "../lib/foliate-engine";
import type { ReaderSelectionState } from "../lib/selection-overlay";
import { readingSelectionUnchanged } from "../lib/reading-document-input";
import { resizeSource, sameResizeSample, sampleResize } from "../lib/resize-source";

const log = createLogger("reader-viewport");

/** The outer viewport drives the responsive text measure. Foliate still owns
 * its immediate native layout; this effect attributes the host's subsequent
 * measure update and selection dismissal to the matching resize. */
export function useReaderViewportResize({ viewportRef, viewRef, selectionRef, clearSelection, applyMaxInlineSize }: {
  viewportRef: RefObject<HTMLElement | null>;
  viewRef: RefObject<FoliateView | null>;
  selectionRef: RefObject<ReaderSelectionState | null>;
  clearSelection(origin: DomainActor): void;
  applyMaxInlineSize(origin: DomainActor): void;
}): void {
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let sample = sampleResize(element), revision = 0;
    const observer = new ResizeObserver(() => {
      const next = sampleResize(element), before = sample;
      if (sameResizeSample(before, next)) return;
      sample = next;
      const request = ++revision, view = viewRef.current, renderer = view?.renderer;
      const selection = selectionRef.current;
      const documents = renderer?.getContents().map(({ doc }) => ({ doc, unchanged: readingSelectionUnchanged(doc) })) ?? [];
      const current = () => revision === request && viewportRef.current === element && viewRef.current === view
        && view?.renderer === renderer && sameResizeSample(next, sampleResize(element));
      void resizeSource(before, next, undefined).catch(error => {
        log.warn("Reader viewport source unavailable", error);
        return causalActor("system");
      }).then(origin => {
        if (!current()) return;
        const contents = renderer?.getContents() ?? [];
        // A new selection or a replaced chapter must survive late resize work.
        if (selectionRef.current === selection && contents.length === documents.length
          && documents.every(({ doc, unchanged }, index) => contents[index]?.doc === doc && unchanged())) clearSelection(origin);
        // Selection observers can synchronously replace the reading view.
        if (current()) applyMaxInlineSize(origin);
      }).catch(error => log.warn("Reader viewport update failed", error));
    });
    observer.observe(element);
    return () => { revision++; observer.disconnect(); };
  }, [viewportRef, viewRef, selectionRef, clearSelection, applyMaxInlineSize]);
}
