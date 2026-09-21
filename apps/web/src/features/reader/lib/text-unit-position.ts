import { AppError } from "@read-aware/core";
import type { FoliateView } from "./foliate-engine";

/** A page boundary strictly inside the unit leaves text to read before stepping.
 * Document order also covers RTL and vertical layouts; adjacent units touching
 * the boundary must not be mistaken for a continuation. */
export function textUnitContinuesBeyondPage(unit: Range, visible: Range | null, direction: -1 | 1): boolean {
  if (!visible || visible.collapsed || unit.startContainer.ownerDocument !== visible.startContainer.ownerDocument) return false;
  const edge = visible.cloneRange(); edge.collapse(direction < 0);
  const start = unit.cloneRange(); start.collapse(true);
  const end = unit.cloneRange(); end.collapse(false);
  return start.compareBoundaryPoints(start.START_TO_START, edge) < 0
    && end.compareBoundaryPoints(end.START_TO_START, edge) > 0;
}

/** Re-resolve the engine CFI against this document; a cached ordinal is not an address. */
export function resolveTextUnitPosition(view: Pick<FoliateView, "resolveCFI">, cfi: string | null, doc: Document, sectionIndex: number, units: Range[]): number {
  try {
    if (!cfi) throw new Error("Missing unit CFI");
    const resolved = view.resolveCFI(cfi);
    if (resolved.index !== sectionIndex) throw new Error("CFI points to a different section");
    const range = typeof resolved.anchor === "function" ? resolved.anchor(doc) : resolved.anchor;
    if (!range || typeof range !== "object" || !("startContainer" in range)
      || range.startContainer.ownerDocument !== doc || !doc.contains(range.startContainer)) throw new Error("CFI has no current range");
    const index = units.findIndex(unit => unit.comparePoint(range.startContainer, range.startOffset) === 0
      && !(unit.endContainer === range.startContainer && unit.endOffset === range.startOffset));
    if (index < 0) throw new Error("No unit contains the restored location");
    return index;
  } catch (cause) {
    throw new AppError("reader/stale-location", "Stored reading unit cannot be resolved", { cause });
  }
}
