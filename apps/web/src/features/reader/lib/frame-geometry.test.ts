import { describe, expect, test } from "bun:test";
import {
  clipRectToRoot,
  frameScale,
  framePointAnchorInRoot,
  framePointToRoot,
  frameRectToRoot,
  measureFrameToRoot,
  measureSectionToRoot,
  visibleFrameRectInRoot,
  type GeometryRect,
} from "./frame-geometry";

const box = (rect: GeometryRect) => ({ getBoundingClientRect: () => rect });
const root: GeometryRect = { left: 20, top: 40, width: 400, height: 900 };

describe("frameScale", () => {
  test("is the drawn width over the layout width", () => {
    expect(frameScale(800, { left: 0, top: 0, width: 400, height: 600 })).toBe(0.5);
    expect(frameScale(400, { left: 0, top: 0, width: 400, height: 600 })).toBe(1);
  });

  test("is 1 when either width is unknown (a detached or collapsed frame)", () => {
    expect(frameScale(0, { left: 0, top: 0, width: 400, height: 600 })).toBe(1);
    expect(frameScale(800, { left: 0, top: 0, width: 0, height: 0 })).toBe(1);
  });
});

describe("frame → root mapping", () => {
  test("a reflowable (unscaled) section offsets by the frame and the root", () => {
    const mapping = measureFrameToRoot(
      { clientWidth: 400, ...box({ left: 20, top: 100, width: 400, height: 800 }) },
      box(root),
    );
    expect(mapping.scale).toBe(1);
    expect(framePointToRoot({ x: 50, y: 30 }, mapping)).toEqual({ x: 50, y: 90 });
  });

  test("a zoomed fixed-layout page applies the frame scale to points and rects", () => {
    // A 800px-wide page fitted into 400px: everything inside draws at half size.
    const mapping = measureFrameToRoot(
      { clientWidth: 800, ...box({ left: 20, top: 100, width: 400, height: 600 }) },
      box(root),
    );
    expect(mapping.scale).toBe(0.5);
    expect(framePointToRoot({ x: 50, y: 30 }, mapping)).toEqual({ x: 25, y: 75 });
    expect(frameRectToRoot({ left: 100, top: 200, width: 60, height: 20 }, mapping))
      .toEqual({ left: 50, top: 160, width: 30, height: 10 });
  });

  test("point anchors and rect anchors agree on a scaled frame", () => {
    // The drift this module closes: a point anchor must land where the rect
    // anchor for the same spot does, zoomed or not.
    const mapping = measureFrameToRoot(
      { clientWidth: 1000, ...box({ left: 20, top: 40, width: 250, height: 400 }) },
      box(root),
    );
    const point = { x: 400, y: 800 };
    const anchor = framePointAnchorInRoot(point, mapping);
    const mapped = framePointToRoot(point, mapping);
    expect(anchor?.left).toBe(mapped.x);
    expect(anchor?.top).toBe(mapped.y);
    expect(anchor).toEqual({ left: 100, top: 200, width: 0.25, height: 0.25 });
  });
});

describe("clipping to the reader root", () => {
  test("keeps the visible part of a rect that straddles an edge", () => {
    expect(clipRectToRoot({ left: -10, top: 880, width: 50, height: 40 }, root))
      .toEqual({ left: 0, top: 880, width: 40, height: 20 });
  });

  test("drops a rect wholly outside the root", () => {
    expect(clipRectToRoot({ left: 500, top: 10, width: 50, height: 40 }, root)).toBeNull();
    expect(clipRectToRoot({ left: 10, top: -60, width: 50, height: 40 }, root)).toBeNull();
  });

  test("visibleFrameRectInRoot maps then clips", () => {
    const mapping = measureFrameToRoot(
      { clientWidth: 800, ...box({ left: 20, top: 40, width: 400, height: 600 }) },
      box(root),
    );
    expect(visibleFrameRectInRoot({ left: 780, top: 0, width: 40, height: 20 }, mapping))
      .toEqual({ left: 390, top: 0, width: 10, height: 10 });
    expect(visibleFrameRectInRoot({ left: 900, top: 0, width: 40, height: 20 }, mapping)).toBeNull();
  });

  test("a point anchor outside the root is null", () => {
    const mapping = measureFrameToRoot(
      { clientWidth: 400, ...box({ left: 20, top: 40, width: 400, height: 900 }) },
      box(root),
    );
    expect(framePointAnchorInRoot({ x: 410, y: 10 }, mapping)).toBeNull();
    expect(framePointAnchorInRoot({ x: 10, y: 10 }, mapping)).toEqual({ left: 10, top: 10, width: 1, height: 1 });
  });
});

describe("measureSectionToRoot", () => {
  test("measures the document's hosting frame", () => {
    const frame = { clientWidth: 800, ...box({ left: 20, top: 40, width: 400, height: 600 }) };
    const doc = { defaultView: { frameElement: frame } } as unknown as Document;
    expect(measureSectionToRoot(doc, box(root))).toEqual({
      frameRect: { left: 20, top: 40, width: 400, height: 600 },
      rootRect: root,
      scale: 0.5,
    });
  });

  test("is null without a root or a hosting frame", () => {
    const orphan = { defaultView: { frameElement: null } } as unknown as Document;
    expect(measureSectionToRoot(orphan, box(root))).toBeNull();
    expect(measureSectionToRoot({ defaultView: null } as unknown as Document, box(root))).toBeNull();
    const frame = { clientWidth: 400, ...box(root) };
    expect(measureSectionToRoot({ defaultView: { frameElement: frame } } as unknown as Document, null)).toBeNull();
  });
});
