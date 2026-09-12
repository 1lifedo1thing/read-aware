import { expect, test } from "bun:test";
import type { BookTextTaskSnapshot } from "@read-aware/core";
import { BookTextTaskHistory, type TextHistoryStorage } from "./book-text-task-history";
const snapshot = (id = "task", n = 0): BookTextTaskSnapshot => ({ taskId: id, bookId: "book", mode: "prepare", priority: "normal", waitReason: null,
  timeoutMs: 1800000, deadlineAt: "2026-09-12T12:30:00Z", createdAt: new Date(1789210416000 + n).toISOString(), updatedAt: "2026-09-12T12:00:00Z", revision: 1,
  status: "running", textState: { bookId: "book", contentVersion: "v", status: "preparing", text: "unknown", chapterCount: 0, progress: null } });
function fixture() {
  let raw: string | null = null, failure = false;
  const tracked: Promise<void>[] = [];
  const storage: TextHistoryStorage = { read: async () => raw, write: async value => { if (failure) throw Error("disk unavailable"); raw = value; }, run: operation => operation() };
  const key = crypto.randomUUID();
  return { create: () => new BookTextTaskHistory(key, storage, work => tracked.push(work)), tracked, raw: () => raw,
    seed: (value: string) => { raw = value; }, fail: (value: boolean) => { failure = value; } };
}

test("restart preserves completed metadata and marks old active requests interrupted without creating handles", async () => {
  const f = fixture(), first = f.create();
  await first.record(snapshot("active")); await first.record({ ...snapshot("done"), status: "completed" });
  expect((await first.list("book", {}, () => true)).items.every(entry => entry.requestAvailable)).toBe(true);
  const next = f.create(), page = await next.list("book", {}, () => false);
  expect(page.items.find(entry => entry.snapshot.taskId === "active")).toMatchObject({ interrupted: true, requestAvailable: false });
  expect(page.items.find(entry => entry.snapshot.taskId === "done")).toMatchObject({ interrupted: false, snapshot: { status: "completed" } });
  expect((await next.list("other", {}, () => false)).items).toEqual([]);
});

test("write failures stay visible and dirty metadata can be retried without losing a sibling record", async () => {
  const f = fixture(), history = f.create(); f.fail(true);
  await expect(history.record(snapshot("a"))).rejects.toThrow("disk unavailable");
  await expect(history.list("book", {}, () => true)).rejects.toThrow("disk unavailable");
  f.fail(false); await history.record({ ...snapshot("b"), status: "completed" });
  const page = await history.list("book", {}, () => true); expect(page.items.map(entry => entry.snapshot.taskId).sort()).toEqual(["a", "b"]);
  const concurrent = f.create();
  await Promise.all([history.record({ ...snapshot("a"), status: "completed", revision: 2 }), concurrent.record(snapshot("c"))]);
  expect((await concurrent.list("book", {}, () => false)).items).toHaveLength(3);
  expect(f.tracked.length).toBeGreaterThan(0);
});

test("bounded history keeps live requests, pages retained metadata and rejects damaged or injected snapshots", async () => {
  const f = fixture(), history = f.create(); await history.record(snapshot("live"));
  for (let i = 1; i < 70; i++) await history.record({ ...snapshot(`done-${i}`, i), status: "completed" });
  const ids: string[] = [];
  for (let offset = 0; offset < 64; offset += 20) {
    const page = await history.list("book", { offset }, id => id === "live");
    expect(page.total).toBe(64); ids.push(...page.items.map(entry => entry.snapshot.taskId));
  }
  expect(ids).toHaveLength(64); expect(ids).toContain("live"); expect(ids).not.toContain("done-1");
  for (const input of [{ offset: -1 }, { limit: null }, { offset: null }, { limit: 21 }, { otherOwner: "a" }]) await expect(history.list("book", input as never, () => false)).rejects.toMatchObject({ code: "library/invalid-input" });
  const stored = JSON.parse(f.raw()!); stored.entries[0].snapshot.secret = "must not leak"; f.seed(JSON.stringify(stored));
  expect(JSON.stringify(await history.list("book", {}, () => false))).not.toContain("must not leak");
  stored.entries[0].snapshot.mode = ["prepare"]; f.seed(JSON.stringify(stored));
  await expect(history.list("book", {}, () => false)).rejects.toMatchObject({ code: "db/error" });
});
