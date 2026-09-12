import { expect, test } from "bun:test";
import type { BookTextTaskHistoryEntry, PluginContext, PluginDetailView } from "@read-aware/plugin-types";
import { taskHistory } from "../src/task-history";

test("saved history pages without replaying old handles; continuation starts a fresh non-rebuild request", async () => {
  const entry: BookTextTaskHistoryEntry = { recordedAt: "2026-09-12T12:00:00Z", requestAvailable: false, interrupted: true,
    snapshot: { taskId: "old", bookId: "book", mode: "rebuild", priority: "normal", waitReason: null, timeoutMs: 1800000,
      deadlineAt: "2026-09-12T12:30:00Z", createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:00Z", revision: 1, status: "running",
      textState: { bookId: "book", contentVersion: "v", status: "preparing", text: "unknown", chapterCount: 0, progress: null } } };
  const queries: unknown[] = [], starts: unknown[] = [];
  let fail = false;
  const ctx = { locale: "en", domains: { library: { queries: { books: {
    listTextTaskHistory: async (bookId: string, query: unknown) => { if (fail) throw Error("history read failed"); queries.push([bookId, query]); return { items: [entry], total: 21, nextOffset: queries.length === 1 ? 20 : null, retainedLimit: 64 }; },
    getTextTask: async () => ({ ...entry.snapshot, mode: "prepare", taskId: "new" }),
  } }, commands: { books: { prepareText: async (bookId: string, input: unknown) => { starts.push([bookId, input]); return { ...entry.snapshot, taskId: "new" }; } } } } } } as unknown as PluginContext;
  const view = await taskHistory(ctx, "book", "Book"); expect(view.items[0]!.subtitle).toBe("Interrupted in an earlier session"); expect(starts).toHaveLength(0);
  await view.actions!.find(a => a.id === "next")!.run(); expect(queries[1]).toEqual(["book", { offset: 20, limit: 20 }]);
  const detail = (await view.items[0]!.onSelect!())!.view as PluginDetailView;
  expect(detail.actions!.some(action => action.id === "current")).toBe(false);
  await detail.actions!.find(a => a.id === "prepare")!.run(); expect(starts).toEqual([["book", { rebuild: false }]]);
  fail = true; await expect(taskHistory(ctx, "book", "Book")).rejects.toThrow("history read failed");
});
