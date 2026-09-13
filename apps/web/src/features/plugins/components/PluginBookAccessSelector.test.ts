import { expect, test } from "bun:test";
import type { PluginBookAccess } from "../lib/plugin-types";
import { availablePluginBooks, isValidPluginBookAccess } from "./PluginBookAccessSelector";

const books = [
  { id: " first ", title: "First" },
  { id: "second", title: "Second" },
  { id: " first ", title: "Duplicate" },
  { id: " ", title: "Blank" },
];

test("book access choices remove blank and duplicate host book ids", () => {
  expect(availablePluginBooks(books)).toEqual([
    { id: "first", title: "First" },
    { id: "second", title: "Second" },
  ]);
});

test("all and current grants are valid without a selected book", () => {
  for (const grant of [{ mode: "all" }, { mode: "current" }] satisfies PluginBookAccess[]) {
    expect(isValidPluginBookAccess(grant, [])).toBe(true);
  }
});

test("a book grant must name a nonblank book currently offered by the host", () => {
  expect(isValidPluginBookAccess({ mode: "book", bookId: "first" }, books)).toBe(true);
  expect(isValidPluginBookAccess({ mode: "book", bookId: "missing" }, books)).toBe(false);
  expect(isValidPluginBookAccess({ mode: "book", bookId: "  " }, books)).toBe(false);
});
