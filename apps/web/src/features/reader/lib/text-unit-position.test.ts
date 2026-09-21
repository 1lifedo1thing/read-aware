import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { resolveTextUnitPosition, textUnitContinuesBeyondPage } from "./text-unit-position";

test("page continuation retains a spanning unit but never consumes an adjacent unit or another document", () => {
  const dom = new JSDOM("<p>01234567890123456789</p>");
  const doc = dom.window.document, text = doc.querySelector("p")!.firstChild!;
  const range = (start: number, end: number) => { const r = doc.createRange(); r.setStart(text, start); r.setEnd(text, end); return r; };
  const unit = range(2, 18);
  expect(textUnitContinuesBeyondPage(unit, range(0, 10), 1)).toBe(true);
  expect(textUnitContinuesBeyondPage(unit, range(0, 10), -1)).toBe(false);
  expect(textUnitContinuesBeyondPage(unit, range(10, 20), -1)).toBe(true);
  expect(textUnitContinuesBeyondPage(unit, range(10, 20), 1)).toBe(false);
  // A paragraph can cover more than two pages, in either writing direction.
  expect(textUnitContinuesBeyondPage(unit, range(6, 12), 1)).toBe(true);
  expect(textUnitContinuesBeyondPage(unit, range(6, 12), -1)).toBe(true);
  expect(textUnitContinuesBeyondPage(unit, range(0, 2), 1)).toBe(false);
  expect(textUnitContinuesBeyondPage(unit, range(18, 20), -1)).toBe(false);
  expect(textUnitContinuesBeyondPage(unit, range(2, 18), 1)).toBe(false);
  expect(textUnitContinuesBeyondPage(unit, null, 1)).toBe(false);
  expect(textUnitContinuesBeyondPage(unit, range(10, 10), 1)).toBe(false);
  const other = doc.implementation.createHTMLDocument();
  const stale = other.createRange(); stale.selectNodeContents(other.body);
  expect(textUnitContinuesBeyondPage(unit, stale, 1)).toBe(false);
  dom.window.close();
});

test("CFI restoration follows the text address rather than a previous segmentation ordinal", () => {
  const dom = new JSDOM("<p>One. Two. Three.</p>");
  const doc = dom.window.document; const text = doc.querySelector("p")!.firstChild!;
  const range = (start: number, end: number) => { const value = doc.createRange(); value.setStart(text, start); value.setEnd(text, end); return value; };
  const view = { resolveCFI: () => ({ index: 2, anchor: () => range(5, 10) }) };
  expect(resolveTextUnitPosition(view, "cfi", doc, 2, [range(0, 5), range(5, 10), range(10, 16)])).toBe(1);
  expect(resolveTextUnitPosition(view, "cfi", doc, 2, [range(0, 16)])).toBe(0);
  expect(() => resolveTextUnitPosition(view, "cfi", doc, 1, [range(0, 16)])).toThrow("Stored reading unit cannot be resolved");
  expect(() => resolveTextUnitPosition(view, null, doc, 2, [range(0, 16)])).toThrow();
  expect(() => resolveTextUnitPosition(view, "cfi", doc, 2, [range(10, 16)])).toThrow();
  dom.window.close();
});

test("invalid CFI or a range from an obsolete document does not silently select unit zero", () => {
  const old = new JSDOM("<p>Old</p>"); const current = new JSDOM("<p>Current</p>");
  const range = old.window.document.createRange(); range.selectNodeContents(old.window.document.body);
  expect(() => resolveTextUnitPosition({ resolveCFI: () => ({ index: 0, anchor: range }) }, "cfi", current.window.document, 0, [])).toThrow();
  expect(() => resolveTextUnitPosition({ resolveCFI: () => { throw new Error("Malformed CFI"); } }, "bad", current.window.document, 0, [])).toThrow();
  old.window.close(); current.window.close();
});
