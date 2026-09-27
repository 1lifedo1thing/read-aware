import type { ResolvedNavigation } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";

/** The renderer of a View that has opened a book; failing loudly keeps a suite honest. */
export function rendererOf(view: View): NonNullable<View["renderer"]> {
  const renderer = view.renderer;
  if (!renderer) throw new Error("The view has no renderer; open a book first");
  return renderer;
}

/** The Range a resolved navigation designates in a loaded document (CFIs resolve to ranges). */
export function anchorRangeOf(resolved: ResolvedNavigation, doc: Document): Range {
  const anchor = typeof resolved.anchor === "function" ? resolved.anchor(doc) : resolved.anchor;
  // Documents live in their own iframe realms, so check the shape rather than `instanceof Range`.
  if (anchor == null || typeof anchor === "number" || !("startContainer" in anchor)) {
    throw new Error("The navigation did not resolve to a range");
  }
  return anchor;
}
