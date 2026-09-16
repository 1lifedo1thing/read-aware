import { expect, test } from "bun:test";
import type { PluginContext, PluginFormView } from "@read-aware/plugin-types";
import { goalsView } from "../src/views";
import { readGoal } from "../src/goals";
import { fixture } from "./fixture";

async function forms(ctx: PluginContext): Promise<PluginFormView[]> {
  const view = await goalsView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  return view.blocks.filter(block => block.kind === "form");
}

test("goal forms validate, await storage, and retain the displayed book when reading moves", async () => {
  const { ctx, state, documents } = fixture();
  const [form] = await forms(ctx);
  for (const goal of [" ", "x".repeat(501)]) expect(await form!.onSubmit({ goal, suggestMemory: false })).toHaveProperty("fieldErrors.goal");
  expect(documents.size).toBe(0);
  state.bookId = "book-2";
  await form!.onSubmit({ goal: "  Understand the argument  ", suggestMemory: true });
  expect(await readGoal(ctx, "book-1")).toEqual({ text: "Understand the argument", suggestMemory: true });
  expect(documents.has("book-2")).toBe(false);
  state.failSave = true;
  await expect(form!.onSubmit({ goal: "replacement", suggestMemory: false })).rejects.toThrow("storage failed");
  expect(await readGoal(ctx, "book-1")).toHaveProperty("text", "Understand the argument");
});

test("context and opt-in candidates use the requested book, never the active reader or another scope", async () => {
  const { ctx, state, context, candidates } = fixture();
  const [form] = await forms(ctx);
  await form!.onSubmit({ goal: "Compare evidence", suggestMemory: false });
  const input = { requestId: "request-1", scope: { kind: "book" as const, bookId: "book-1" }, userText: "question", assistantText: "answer" };
  state.bookId = "book-2";
  expect(await context.provide(input)).toEqual([{ title: "Reading Goals", content: "Compare evidence" }]);
  expect(await candidates.propose(input)).toEqual([]);
  state.bookId = "book-1";
  await (await forms(ctx))[0]!.onSubmit({ goal: "Compare evidence", suggestMemory: true });
  state.bookId = "book-2";
  expect(await candidates.propose(input)).toEqual([{ scope: "book", kind: "preference", content: "Compare evidence" }]);
  expect(await context.provide({ ...input, scope: { kind: "book", bookId: "book-2" } })).toEqual([]);
  expect(await candidates.propose({ ...input, scope: { kind: "global", threadId: "x" } })).toEqual([]);
});

test("a memory suggestion while long-term memory is off shows the host setting notice, never writes it", async () => {
  const { ctx, state, saved } = fixture();
  state.memory = false;
  const [form] = await forms(ctx);
  expect(await form!.onSubmit({ goal: "Keep this", suggestMemory: true })).toMatchObject({ toast: "Goal saved", navigation: "replace" });
  const view = await goalsView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  expect(view.blocks.some(block => block.kind === "alert" && block.message.includes("Long-term memory is turned off"))).toBe(true);
  expect(view.blocks[0]).toMatchObject({ kind: "heading", text: "book-1" });
  expect(state.memory).toBe(false); expect(saved.size).toBe(0);
  state.memory = true;
  const enabled = await goalsView(ctx);
  if (enabled.kind !== "blocks") throw new Error("Expected blocks");
  expect(enabled.blocks.some(block => block.kind === "alert")).toBe(false);
});

test("clear removes only this book's goal and no-book is an explicit state", async () => {
  const { ctx, saved, state } = fixture();
  saved.set("goal:book-1", { text: "one", suggestMemory: true });
  saved.set("goal:book-2", { text: "two", suggestMemory: false });
  const view = await goalsView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const actions = view.blocks.find(block => block.kind === "actions");
  if (actions?.kind !== "actions") throw new Error("Expected actions");
  const result = await actions.actions.find(action => action.id === "clear")!.run();
  if (result?.view?.kind !== "form") throw Error("Expected clear confirmation");
  expect(await result.view.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(await readGoal(ctx, "book-1")).not.toBeNull();
  expect(await result.view.onSubmit({ confirm: true })).toMatchObject({ toast: "Goal cleared" });
  expect(await readGoal(ctx, "book-1")).toBeNull(); expect(saved.has("goal:book-2")).toBe(true);
  state.bookId = null;
  expect(JSON.stringify(await goalsView(ctx))).toContain("Open a book to set a reading goal");
});
