import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError, type DigestReport } from "@read-aware/core";
import { BookGraphTaskOwner, type BookGraphTaskExecution } from "./book-graph-tasks";
import { createInMemoryDeps } from "../testing/fixtures";
import { digestBookCatchUp, digestBookTick, type DigestBookTickInput } from "./graph-upkeep";
import { runMemoryBuild } from "./build-policy";

const empty: DigestReport = { status: "complete", eligible: 0, attempted: 0, digested: 0, remaining: 0, emptyChapters: [], failures: [] };
const next = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test("graph invalidations retain execution context, cancellation feedback and the caller causing eviction", async () => {
  const gate = deferred(), start = {}, cancel = {}, retry = {}, eviction = {};
  const observed: { bookId: string; kind: string; taskId: string; context: unknown }[] = [], executionContexts: unknown[] = [];
  const owner = new BookGraphTaskOwner<object>(async (input, context) => {
    executionContexts.push(context); input.onStarted(); await gate.promise;
    return { ...empty, status: "partial", remaining: 1 };
  }, () => {});
  const stop = owner.subscribeChanges((change, context) => { observed.push({ ...change, context }); });
  const task = await owner.start("b", "catch-up", undefined, undefined, start);
  expect(observed.map(item => item.context)).toEqual([start, start]);
  await owner.cancel("b", task.taskId, cancel); gate.resolve(); await owner.drain();
  expect(observed.slice(2).map(item => item.context)).toEqual([cancel, cancel]);
  expect(executionContexts).toEqual([start]);
  await owner.retry("b", task.taskId, undefined, undefined, retry); await owner.drain();
  expect(executionContexts[executionContexts.length - 1]).toBe(retry); expect(observed[observed.length - 1]?.context).toBe(retry);
  for (let i = 0; i < 63; i++) { await owner.start("b", "catch-up", undefined, undefined, eviction); await owner.drain(); }
  expect(observed.find(item => item.kind === "removed")).toEqual({ bookId: "b", taskId: task.taskId, kind: "removed", context: eviction });
  const count = observed.length; stop(); await owner.start("b", "catch-up"); await owner.drain(); expect(observed).toHaveLength(count);
  owner.dispose(); expect(() => owner.subscribeChanges(() => {})).toThrow(expect.objectContaining({ code: "memory/cancelled" }));
});

test("reentrant cancellation from a queued invalidation cannot recurse or dispatch execution", async () => {
  let calls = 0, notifications = 0;
  const owner = new BookGraphTaskOwner(async () => { calls++; return empty; }, () => {});
  owner.subscribeChanges(change => { notifications++; void owner.cancel(change.bookId, change.taskId); });
  const task = await owner.start("b", "catch-up"); await owner.drain();
  expect(calls).toBe(0); expect(notifications).toBe(3); expect((await owner.get("b", task.taskId)).status).toBe("cancelled"); owner.dispose();
});

test("shared task ownership retains distinct host contexts after dispatch and uses the retry caller's context", async () => {
  const gate = deferred(), first = {}, second = {}, retry = {};
  const received: unknown[] = [];
  const owner = new BookGraphTaskOwner<object>(async (_input, context) => {
    await gate.promise; received.push(context);
    return { ...empty, status: "partial", remaining: 1 };
  }, () => {});
  const a = await owner.start("a", "catch-up", undefined, undefined, first);
  const b = await owner.start("b", "catch-up", undefined, undefined, second);
  expect(Object.keys(a)).not.toContain("context");
  gate.resolve(); await owner.drain();
  expect(received[0]).toBe(first); expect(received[1]).toBe(second);
  await owner.retry("a", a.taskId, undefined, undefined, retry); await owner.drain();
  expect(received[2]).toBe(retry);
  expect((await owner.get("b", b.taskId)).taskId).toBe(b.taskId);
  owner.dispose();
});

test("retirement drains every execution after handles disappear, including a failed cancelled source", async () => {
  const first = deferred(), second = deferred(), lifetime = new AbortController();
  const signals: AbortSignal[] = [];
  const owner = new BookGraphTaskOwner(async input => {
    signals.push(input.signal);
    if (input.bookId === "first") { await first.promise; return empty; }
    await second.promise; throw new AppError("db/locked", "Pending write failed");
  }, () => {}, lifetime.signal);
  await owner.start("first", "catch-up"); await owner.start("second", "rebuild");
  lifetime.abort(); expect(signals.every(signal => signal.aborted)).toBe(true);
  await expect(owner.list("first")).rejects.toMatchObject({ code: "memory/cancelled" });
  let drained = false;
  const draining = owner.drain().then(() => { drained = true; });
  await next(); expect(drained).toBe(false);
  first.resolve(); await next(); expect(drained).toBe(false);
  second.resolve(); await draining; expect(drained).toBe(true);
});

test("retirement before dispatch prevents execution; reentrant retirement still tracks completion", async () => {
  let calls = 0;
  const owner = new BookGraphTaskOwner(async () => { calls++; return empty; }, () => {});
  const started = owner.start("b", "catch-up"); owner.dispose();
  await started; await owner.drain(); expect(calls).toBe(0);

  const gate = deferred(); let drained = false, draining!: Promise<void>;
  const reentrant = new BookGraphTaskOwner(async () => {
    reentrant.dispose(); draining = reentrant.drain().then(() => { drained = true; });
    await gate.promise; return empty;
  }, () => {});
  await reentrant.start("b", "catch-up");
  await next(); expect(drained).toBe(false);
  gate.resolve(); await draining; expect(drained).toBe(true);
});

async function done(owner: BookGraphTaskOwner, id: string) {
  for (let i = 0; i < 100; i++) { const task = await owner.get("b", id); if (!["queued", "running", "cancelling"].includes(task.status)) return task; await next(); }
  throw Error("Task did not settle");
}

test("handles isolate owners/books, cancellation waits for execution, and terminal snapshots cannot be mutated", async () => {
  const gate = deferred(); let execution!: BookGraphTaskExecution;
  const owner = new BookGraphTaskOwner(async input => { execution = input; input.onStarted(); await gate.promise; return empty; }, () => {});
  const task = await owner.start("b", "catch-up");
  expect(task.status).toBe("queued"); expect((await owner.get("b", task.taskId)).status).toBe("running");
  await expect(owner.get("other", task.taskId)).rejects.toMatchObject({ code: "memory/task-not-found" });
  await expect(new BookGraphTaskOwner(async () => empty, () => {}).get("b", task.taskId)).rejects.toMatchObject({ code: "memory/task-not-found" });
  expect((await owner.cancel("b", task.taskId)).status).toBe("cancelling"); expect(execution.signal.aborted).toBe(true);
  await expect(owner.retry("b", task.taskId)).rejects.toMatchObject({ code: "memory/conflict" });
  gate.resolve(); const final = await done(owner, task.taskId); expect(final.status).toBe("cancelled");
  final.status = "completed"; expect((await owner.cancel("b", task.taskId)).status).toBe("cancelled");
  const terminal = await owner.get("b", task.taskId);
  execution.onStarted(); execution.onReport({ ...empty, digested: 999 });
  expect(await owner.get("b", task.taskId)).toEqual(terminal);
});

test("actor capacity, terminal eviction and generation retirement are bounded", async () => {
  const gate = deferred(), life = new AbortController(), signals: AbortSignal[] = [];
  const owner = new BookGraphTaskOwner(async input => { signals.push(input.signal); await gate.promise; return empty; }, () => {}, life.signal);
  expect(owner.capacityConditions()[0]!.state).toBe("satisfied");
  const tasks = await Promise.all(Array.from({ length: 16 }, () => owner.start("b", "catch-up")));
  expect(owner.capacityConditions()[0]).toMatchObject({ state: "unavailable", errorCode: "memory/task-limit" });
  await expect(owner.start("b", "catch-up")).rejects.toMatchObject({ code: "memory/task-limit" });
  gate.resolve(); await done(owner, tasks[0]!.taskId);
  for (let i = 0; i < 65; i++) { const task = await owner.start("b", "catch-up"); await done(owner, task.taskId); }
  expect(await owner.list("b")).toHaveLength(64);
  await expect(owner.get("b", tasks[0]!.taskId)).rejects.toMatchObject({ code: "memory/task-not-found" });
  life.abort(); await expect(owner.list("b")).rejects.toMatchObject({ code: "memory/cancelled" });
  const pendingGate = deferred(), retired = new AbortController(); let signal!: AbortSignal;
  const active = new BookGraphTaskOwner(async input => { signal = input.signal; await pendingGate.promise; return empty; }, () => {}, retired.signal);
  await active.start("b", "rebuild"); retired.abort(); expect(signal.aborted).toBe(true); pendingGate.resolve(); await next();
});

test("late execution callbacks cannot alter a terminal retry plan or retained report", async () => {
  let execution!: BookGraphTaskExecution;
  const report: DigestReport = { ...empty, status: "partial", remaining: 1, failures: [] };
  const owner = new BookGraphTaskOwner(async input => {
    execution = input;
    input.onPlan(input.targets ? [...input.targets] : [0, 1]);
    input.onChapterCommitted(1);
    return report;
  }, () => {});
  const first = await done(owner, (await owner.start("b", "rebuild")).taskId);
  execution.onPlan([2]); execution.onChapterCommitted(0);
  report.remaining = 999; report.failures.push({ chapterIndex: 9, errorCode: "ai/provider" });
  expect(await owner.get("b", first.taskId)).toEqual(first);
  await owner.retry("b", first.taskId);
  expect(execution.targets).toEqual([0]);
});

test("failed rebuild keeps old digests and retry targets only failed rebuild chapters", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative", spoilerSensitive: true }],
    chapters: { b: [0, 1].map(index => ({ title: `C${index}`, text: `Text${index}`, hrefs: [String(index)] })) } });
  const model = { id: "fixture" } as DigestBookTickInput["model"];
  const reply = (summary: string) => fauxAssistantMessage(JSON.stringify({ summary, characters: [], relations: [] }));
  await digestBookCatchUp({ deps, bookId: "b", model, complete: async () => reply("Old") });
  let calls = 0;
  const owner = new BookGraphTaskOwner(input => runMemoryBuild(deps, operation => digestBookCatchUp({
    ...input, deps: operation.protect(deps), model, signal: operation.signal,
    complete: operation.complete(async () => { if (++calls === 1) throw new AppError("ai/provider", "failure"); return reply("New"); }),
  }), input.signal), () => {});
  const first = await done(owner, (await owner.start("b", "rebuild")).taskId);
  expect(first).toMatchObject({ status: "partial", report: { attempted: 2, digested: 1, remaining: 1, failures: [{ chapterIndex: 0, errorCode: "ai/provider" }] } });
  expect((await deps.bookMemory.listDigests("b")).map(row => row.summary)).toEqual(["Old", "New"]);
  const retry = await done(owner, (await owner.retry("b", first.taskId)).taskId);
  expect(retry).toMatchObject({ status: "completed", retryOf: first.taskId, report: { attempted: 1, digested: 1 } });
  expect(calls).toBe(3); expect((await deps.bookMemory.listDigests("b")).map(row => row.summary)).toEqual(["New", "New"]);
  await expect(owner.retry("b", retry.taskId)).rejects.toMatchObject({ code: "memory/conflict" });
});

test("public boundary is resolved after queueing and rechecked before a generated chapter writes", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative", spoilerSensitive: true }], chapters: { b: [{ title: "C", text: "Text", hrefs: ["0"] }] } });
  const model = { id: "fixture" } as DigestBookTickInput["model"], gate = deferred(); let ceiling: number | undefined = 1, calls = 0;
  const busy = deps.bookMemory.runExclusive("b", () => gate.promise);
  const run = () => digestBookCatchUp({ deps, bookId: "b", model, resolveBoundary: async () => ceiling,
    checkChapter: async index => { if (ceiling === undefined || index >= ceiling) throw new AppError("memory/conflict", "boundary"); },
    complete: async () => { calls++; ceiling = 0; return fauxAssistantMessage('{"summary":"Late","characters":[],"relations":[]}'); } });
  const queued = run(); ceiling = undefined; gate.resolve(); await busy;
  expect(await queued).toMatchObject({ status: "unavailable", reason: "boundary-unknown" }); expect(calls).toBe(0);
  ceiling = 1; expect(await run()).toMatchObject({ status: "partial", digested: 0, failures: [{ chapterIndex: 0, errorCode: "memory/conflict" }] });
  expect(await deps.bookMemory.listDigests("b")).toHaveLength(0);
});

test("chapter attempts are bounded across concurrency, failures, empty text and renewed retries", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished", narrativity: "narrative", spoilerSensitive: true }],
    chapters: { b: [0, 1, 2, 3].map(index => ({ title: `C${index}`, text: index === 0 ? " " : `Text${index}`, hrefs: [String(index)] })) } });
  const seen: number[] = []; let fail = true;
  const owner = new BookGraphTaskOwner(input => digestBookTick({ ...input, deps, model: { id: "fixture" } as DigestBookTickInput["model"], concurrency: 2,
    complete: async (_model, context) => {
      const chapter = Number(String(context.messages[0]!.content).match(/chapterIndex \(not a printed chapter number\): (\d+)/)![1]); seen.push(chapter);
      if (fail && chapter === 1) throw new AppError("ai/provider", "failure");
      return fauxAssistantMessage('{"summary":"Saved","characters":[],"relations":[]}');
    },
  }), () => {});
  const options = { maxChapters: 2 };
  const started = owner.start("b", "rebuild", options); options.maxChapters = 1000;
  const first = await done(owner, (await started).taskId);
  expect(first).toMatchObject({ maxChapters: 2, status: "partial", report: { reason: "chapter-limit", attempted: 2, digested: 0, remaining: 4, emptyChapters: [0], failures: [{ chapterIndex: 1, errorCode: "ai/provider" }] } });
  expect(seen).toEqual([1]);
  fail = false;
  const second = await done(owner, (await owner.retry("b", first.taskId)).taskId);
  expect(second).toMatchObject({ maxChapters: 2, report: { attempted: 2, digested: 2, remaining: 2 } });
  const third = await done(owner, (await owner.retry("b", second.taskId, { maxChapters: 3 })).taskId);
  expect(third).toMatchObject({ maxChapters: 3, report: { attempted: 2, digested: 1, remaining: 1, emptyChapters: [0] } });
  expect(third.report?.reason).toBeUndefined(); expect(seen).toEqual([1, 2, 3, 1]);
});

test("invalid graph budgets are rejected before starting; defaults and caller cancellation remain explicit", async () => {
  let calls = 0;
  const owner = new BookGraphTaskOwner(async () => { calls++; return empty; }, () => {});
  for (const options of [null, [], {}, { maxChapters: "1" }, { maxChapters: 0 }, { maxChapters: 1001 }, { maxChapters: 1.5 }, { maxChapters: Infinity }, { maxChapters: NaN }, { maxChapters: 1, unknown: true }])
    await expect(owner.start("b", "rebuild", options as never)).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(calls).toBe(0);
  expect((await owner.start("b", "catch-up")).maxChapters).toBe(20);
  const signal = AbortSignal.abort(); await expect(owner.start("b", "rebuild", { maxChapters: 1 }, signal)).rejects.toMatchObject({ code: "memory/cancelled" });
  expect(calls).toBe(1);
});
