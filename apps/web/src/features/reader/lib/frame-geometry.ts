/**
 * Geometry between a section document and the reader root.
 *
 * Foliate renders every section in an iframe. Coordinates measured inside it
 * (event client points, range rects) live in the iframe's own client space;
 * menus, popovers and overlays are positioned in the reader root's space. The
 * iframe may also be displayed scaled — the fixed-layout renderer fits a page
 * to the window with a CSS transform — so a mapping is offset AND scale.
 *
 * This is the one implementation of that mapping. The scale is part of the
 * measured mapping rather than an optional argument, so no caller can forget
 * it: a mapping without the frame scale was exactly how anchors drifted off
 * zoomed fixed-layout pages.
 */

export type GeometryPoint = { x: number; y: number };
export type GeometryRect = { left: number; top: number; width: number; height: number };

/** A section iframe as the mapping sees it: its layout width, and where it
 *  is drawn in the host. `Element` satisfies this. */
export type SectionFrameLike = {
  readonly clientWidth: number;
  getBoundingClientRect(): GeometryRect;
};

/** The reader root as the mapping sees it. */
export type ReaderRootLike = { getBoundingClientRect(): GeometryRect };

/** A measured frame → reader-root mapping; valid until either box moves. */
export type FrameToRootMapping = {
  frameRect: GeometryRect;
  rootRect: GeometryRect;
  /** Drawn width over layout width: 1 for a reflowable section, the fit
   *  factor for a fixed-layout page. The fixed-layout renderer scales
   *  uniformly, so one factor serves both axes. */
  scale: number;
};

/** How much the host draws a frame larger (or smaller) than its layout. */
export function frameScale(layoutWidth: number, frameRect: GeometryRect): number {
  if (!layoutWidth || !frameRect.width) return 1;
  return frameRect.width / layoutWidth;
}

/** Measure the mapping for one section frame against the reader root. */
export function measureFrameToRoot(frame: SectionFrameLike, root: ReaderRootLike): FrameToRootMapping {
  const frameRect = frame.getBoundingClientRect();
  return { frameRect, rootRect: root.getBoundingClientRect(), scale: frameScale(frame.clientWidth, frameRect) };
}

/**
 * Measure the mapping for the section document `doc`, or null when there is
 * no root, or the document is not (or no longer) hosted in a frame.
 */
export function measureSectionToRoot(
  doc: Document | null | undefined,
  root: ReaderRootLike | null | undefined,
): FrameToRootMapping | null {
  const frame = doc?.defaultView?.frameElement;
  if (!root || !frame) return null;
  return measureFrameToRoot(frame, root);
}

/** A point in the section's client space, in reader-root coordinates. */
export function framePointToRoot(point: GeometryPoint, mapping: FrameToRootMapping): GeometryPoint {
  const { frameRect, rootRect, scale } = mapping;
  return {
    x: frameRect.left + point.x * scale - rootRect.left,
    y: frameRect.top + point.y * scale - rootRect.top,
  };
}

/** A rect in the section's client space, in reader-root coordinates
 *  (unclipped: it may extend past the root). */
export function frameRectToRoot(rect: GeometryRect, mapping: FrameToRootMapping): GeometryRect {
  const topLeft = framePointToRoot({ x: rect.left, y: rect.top }, mapping);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: rect.width * mapping.scale,
    height: rect.height * mapping.scale,
  };
}

/** Clip a reader-root rect to the root's bounds; null when nothing of it is
 *  inside (scrolled out, or on a column the reader can't see). */
export function clipRectToRoot(rect: GeometryRect, rootRect: GeometryRect): GeometryRect | null {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(rootRect.width, rect.left + rect.width);
  const bottom = Math.min(rootRect.height, rect.top + rect.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

/** The visible part of a section rect, in reader-root coordinates — what an
 *  overlay or menu anchors to. */
export function visibleFrameRectInRoot(rect: GeometryRect, mapping: FrameToRootMapping): GeometryRect | null {
  return clipRectToRoot(frameRectToRoot(rect, mapping), mapping.rootRect);
}

/** A section point as a 1×1 anchor inside the reader root, or null when the
 *  point lands outside it. */
export function framePointAnchorInRoot(point: GeometryPoint, mapping: FrameToRootMapping): GeometryRect | null {
  return visibleFrameRectInRoot({ left: point.x, top: point.y, width: 1, height: 1 }, mapping);
}
