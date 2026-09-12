import { expect, spyOn, test } from "bun:test";
import type { BookTextTaskSnapshot } from "@read-aware/core";
import { createTextTaskHistory } from "./book-text-history-storage";
import * as backend from "../../plugins/runtime/plugin-backend";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";

const task: BookTextTaskSnapshot = { taskId: "task", bookId: "book", mode: "prepare", priority: "normal", status: "completed", revision: 2,
  waitReason: null, timeoutMs: 1800000, deadlineAt: "2026-09-12T12:30:00Z", createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:01:00Z",
  textState: { bookId: "book", contentVersion: "v", status: "ready", text: "available", chapterCount: 1, progress: null } };

test("history uses the host-reserved owner namespace and participates in backup exclusion and lifecycle drain", async () => {
  const values = new Map<string, string>(), calls: unknown[] = [], tracked: Promise<void>[] = [];
  const get = spyOn(backend, "pluginDocsGet").mockImplementation(async (owner, collection, id) => {
    expect(collection).toBe("_host_text_history"); expect(id).toBe("recent");
    return values.has(owner) ? { json: values.get(owner)! } as never : null;
  });
  const put = spyOn(backend, "pluginDocsPut").mockImplementation(async (owner, collection, id, json) => {
    calls.push([owner, collection, id]); values.set(owner, json);
  });
  try {
    const history = createTextTaskHistory("plugin:history-a", work => tracked.push(work));
    await history.record(task); expect(tracked).toHaveLength(1);
    expect(calls).toEqual([["history-a", "_host_text_history", "recent"]]);
    expect((await createTextTaskHistory("plugin:history-b").list("book", {}, () => false)).items).toEqual([]);
    await withPluginDataBackup("export", async () => {
      await expect(history.record({ ...task, revision: 3 })).rejects.toMatchObject({ code: "backup/busy" });
      expect(calls).toHaveLength(1);
    });
    expect((await history.list("book", {}, () => true)).items[0]!.snapshot.revision).toBe(3); // Retry dirty metadata after the barrier.
    values.clear(); expect((await history.list("book", {}, () => false)).items).toEqual([]); // No cached namespace resurrected after cleanup/restore.
  } finally { await Promise.allSettled(tracked); get.mockRestore(); put.mockRestore(); }
});
