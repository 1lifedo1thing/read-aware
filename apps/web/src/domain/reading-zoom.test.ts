import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_FIXED_LAYOUT_ZOOM, ZOOM_FACTOR_MAX, normalizeFixedLayoutZoom } from "../../foliate-js/src/fixed-zoom";
import { FIXED_LAYOUT_ZOOM_KEY, getFixedLayoutZooms, saveFixedLayoutZoom } from "./reading-zoom";

describe("per-book memory", () => {
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
  });
  afterAll(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  beforeEach(() => store.clear());

  test("remembers a book's zoom and forgets it back at the default", () => {
    saveFixedLayoutZoom("book-a", { fit: "page", factor: 1.5 }, "user");
    saveFixedLayoutZoom("book-b", { fit: "auto", factor: 2 }, "user");
    expect(getFixedLayoutZooms()).toEqual({
      "book-a": { fit: "page", factor: 1.5 },
      "book-b": { fit: "auto", factor: 2 },
    });
    saveFixedLayoutZoom("book-a", DEFAULT_FIXED_LAYOUT_ZOOM, "user");
    expect(getFixedLayoutZooms()).toEqual({ "book-b": { fit: "auto", factor: 2 } });
  });

  test("reads damaged records as the default rather than failing", () => {
    store.set(FIXED_LAYOUT_ZOOM_KEY, JSON.stringify({ a: { fit: "sideways", factor: 99 }, b: "junk" }));
    expect(getFixedLayoutZooms()).toEqual({
      a: { fit: "auto", factor: ZOOM_FACTOR_MAX },
      b: DEFAULT_FIXED_LAYOUT_ZOOM,
    });
    store.set(FIXED_LAYOUT_ZOOM_KEY, "{not json");
    expect(getFixedLayoutZooms()).toEqual({});
    expect(normalizeFixedLayoutZoom(null)).toEqual(DEFAULT_FIXED_LAYOUT_ZOOM);
  });
});
