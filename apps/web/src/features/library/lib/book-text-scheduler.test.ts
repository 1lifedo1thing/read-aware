import { expect, test } from "bun:test";
import type { BookTextPriority, BookTextWaitReason } from "@read-aware/core";
import { BookTextScheduler } from "./book-text-scheduler";
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("section scheduling observes current priority, bounds real reads and gives background work a turn", async () => {
  const scheduler = new BookTextScheduler(async () => {});
  const entered: string[] = [], gates = new Map<string, ReturnType<typeof Promise.withResolvers<string>>>();
  const priority = new Map<string, BookTextPriority>();
  let concurrent = 0, peak = 0;
  const start = (id: string, tier: BookTextPriority) => {
    priority.set(id, tier); const gate = Promise.withResolvers<string>(); gates.set(id, gate);
    return scheduler.read(new AbortController().signal, () => priority.get(id)!, () => {}, async () => {
      entered.push(id); peak = Math.max(peak, ++concurrent);
      try { return await gate.promise; } finally { concurrent--; }
    });
  };
  const pending = [start("a", "normal"), start("b", "normal"), start("bg", "background"), start("c", "normal"), start("d", "normal"), start("e", "normal")];
  await tick(); expect(entered).toEqual(["a", "b"]);
  gates.get("a")!.resolve("a"); await tick(); expect(entered.at(-1)).toBe("c");
  gates.get("b")!.resolve("b"); await tick(); expect(entered.at(-1)).toBe("d");
  gates.get("c")!.resolve("c"); await tick(); expect(entered.at(-1)).toBe("bg");
  // A queued priority change takes effect without a new request or parser.
  const last = start("last", "background"); pending.push(last); priority.set("e", "background"); priority.set("last", "normal");
  gates.get("d")!.resolve("d"); await tick(); expect(entered.at(-1)).toBe("last");
  for (const gate of gates.values()) gate.resolve("done"); await Promise.all(pending);
  expect(peak).toBe(2);
});

test("reader yielding is visible and queued cancellation dispatches nothing; running cancellation retains capacity", async () => {
  const reader = Promise.withResolvers<void>(), source = Promise.withResolvers<string>();
  const reasons: BookTextWaitReason[] = [];
  let reads = 0;
  const scheduler = new BookTextScheduler(async (signal, waiting) => { waiting(true); await reader.promise; signal.throwIfAborted(); waiting(false); });
  const a = new AbortController(), b = new AbortController(), queued = new AbortController();
  const first = scheduler.read(a.signal, () => "normal", reason => reasons.push(reason), async () => { reads++; return source.promise; }).catch(e => e);
  const second = scheduler.read(b.signal, () => "normal", () => {}, async () => { reads++; return source.promise; });
  const cancelled = scheduler.read(queued.signal, () => "normal", () => {}, async () => { throw Error("must not run"); }).catch(e => e);
  queued.abort(Error("queued cancellation")); expect((await cancelled).message).toBe("queued cancellation");
  expect(reasons).toContain("reader"); expect(reads).toBe(0);
  reader.resolve(); await tick(); expect(reads).toBe(2);
  a.abort(Error("source still draining"));
  const next = scheduler.read(new AbortController().signal, () => "normal", () => {}, async () => { reads++; return "next"; });
  await tick(); expect(reads).toBe(2);
  source.resolve("done"); expect((await first).message).toBe("source still draining");
  expect(await second).toBe("done"); expect(await next).toBe("next"); expect(reasons.at(-1)).toBeNull();
});
