import { expect, test } from "bun:test";
import { fixture } from "./fixture";
import { readGoalState, writeGoal } from "../src/goals";
import { copy } from "../src/strings";

test("candidates follow the requested book's opted-in goal and nothing else", async () => {
  const { ctx, candidates, state } = fixture();
  const input = { requestId: "one", scope: { kind: "book" as const, bookId: "book-1" }, userText: "q", assistantText: "a" };
  expect(await candidates.propose(input)).toEqual([]);
  await writeGoal(ctx, "book-1", { text: "Understand evidence", suggestMemory: false }, null);
  expect(await candidates.propose(input)).toEqual([]);
  const state1 = await readGoalState(ctx, "book-1");
  await writeGoal(ctx, "book-1", { text: "Understand evidence", suggestMemory: true }, state1.revision);
  state.bookId = "book-2";
  expect(await candidates.propose(input)).toEqual([{ scope: "book", kind: "preference", content: "Understand evidence" }]);
  expect(await candidates.propose({ ...input, scope: { kind: "global", threadId: "x" } })).toEqual([]);
  expect(candidates.contexts).toEqual(["book"]);
});

test("all eight product locales have complete, distinct copy", () => {
  const keys = Object.keys(copy("en"));
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    expect(Object.keys(copy(locale))).toEqual(keys);
    expect(Object.values(copy(locale)).every(value => value.length > 0)).toBe(true);
    if (locale !== "en") expect(copy(locale).goal).not.toBe(copy("en").goal);
  }
  expect(copy("zh-CN").title).toBe(copy("zh-Hans").title);
});
