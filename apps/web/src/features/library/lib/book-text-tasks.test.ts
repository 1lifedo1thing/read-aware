import { expect, spyOn, test } from "bun:test";
import { AppError, type BookTextSnapshot, type BookTextTaskSnapshot } from "@read-aware/core";
import { BookTextTaskOwner } from "./book-text-tasks";
import { actorCause, eventCause, causalActor } from "../../../platform/domain-actor";
import type { TextPreparationOptions } from "./book-text-repository";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const state = (bookId = "book", status: BookTextSnapshot["status"] = "unprepared"): BookTextSnapshot => ({ bookId, contentVersion: "sha256:a", status, text: "unknown", chapterCount: 0, progress: null });
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(lifetime?: AbortSignal) {
  const work: { options: TextPreparationOptions; result: ReturnType<typeof deferred<BookTextSnapshot>> }[] = [];
  const warnings: unknown[] = [];
  let readError: unknown;
  const owner = new BookTextTaskOwner({
    snapshot: async bookId => { if (readError) throw readError; return state(bookId); },
    prepare: async (_bookId, options = {}) => { const result = deferred<BookTextSnapshot>(); work.push({ options, result }); return result.promise; },
  }, (_message, error) => { warnings.push(error); }, lifetime);
  return { owner, work, warnings, failRead: (error: unknown) => { readError = error; } };
}

test("text request source is captured per run, including pause and a later independent resume", async () => {
  const h = harness(), start = causalActor("plugin:start"), pause = causalActor("plugin:pause"), resume = causalActor("user");
  const task = await h.owner.start("book", {}, start), first = h.work[0]!.options;
  expect(first.origin).toBe(start);
  h.owner.pause("book", task.taskId, pause); expect(first.cancellationOrigin?.()).toBe(pause);
  h.owner.resume("book", task.taskId, resume);
  expect(h.work[1]!.options.origin).toBe(resume); expect(first.cancellationOrigin?.()).toBe(pause);
  h.work[0]!.result.resolve(state("book", "ready")); await settle();
  expect(h.owner.get("book", task.taskId).status).toBe("running");
  h.work[1]!.result.resolve(state("book", "ready")); await settle(); expect(h.owner.get("book", task.taskId).status).toBe("completed"); h.owner.dispose();
});

test("task receipts are actor/book scoped, cloned, and not completion acknowledgements", async () => {
  const h = harness(); const other = harness();
  const started = await h.owner.start("book");
  expect(started.status).toBe("running"); expect(started.revision).toBe(1);
  expect(h.owner.list("book")).toHaveLength(1); expect(h.owner.list("other")).toEqual([]);
  expect(() => other.owner.get("book", started.taskId)).toThrow();
  expect(() => h.owner.cancel("other", started.taskId)).toThrow();
  started.status = "completed";
  expect(h.owner.get("book", started.taskId).status).toBe("running");
  h.work[0]!.options.progress?.({ ...state(), status: "preparing", progress: { total: 4, completed: 2, failed: 0, unsupported: 0 } });
  expect(h.owner.get("book", started.taskId).textState.progress?.completed).toBe(2);
  h.work[0]!.result.resolve(state("book", "ready")); await settle();
  const completed = h.owner.get("book", started.taskId);
  expect(completed.status).toBe("completed"); expect(completed.revision).toBeGreaterThan(1);
  expect(h.owner.cancel("book", started.taskId)).toEqual(completed);
});

test("cancel is immediate and idempotent; late success and failure cannot replace cancellation", async () => {
  for (const reject of [false, true]) {
    const h = harness(); const started = await h.owner.start("book");
    const cancelled = h.owner.cancel("book", started.taskId);
    expect(cancelled.status).toBe("cancelled"); expect(h.work[0]!.options.signal!.aborted).toBe(true);
    expect(h.owner.cancel("book", started.taskId)).toEqual(cancelled);
    if (reject) h.work[0]!.result.reject(Error("late failure")); else h.work[0]!.result.resolve(state("book", "ready"));
    await settle(); expect(h.owner.get("book", started.taskId)).toEqual(cancelled);
  }
});

test("failed requests preserve codes; a failed diagnostic read is not an empty successful result", async () => {
  const h = harness(); const started = await h.owner.start("book");
  h.failRead(new AppError("db/locked", "diagnostic failed"));
  h.work[0]!.result.reject(new AppError("fs/permission", "raw private file")); await settle();
  expect(h.owner.get("book", started.taskId)).toMatchObject({ status: "failed", errorCode: "fs/permission" });
  expect(JSON.stringify(h.owner.get("book", started.taskId))).not.toContain("raw private"); expect(h.warnings).toHaveLength(2);
  await expect(h.owner.start("next")).rejects.toMatchObject({ code: "db/locked" });
  expect(h.owner.list("next")).toEqual([]);
});

test("task observation coalesces slow callbacks and preserves the terminal revision", async () => {
  const h = harness(), origin = causalActor("plugin:text-source"); const started = await h.owner.start("book", {}, origin);
  const gate = deferred<void>(); const seen: BookTextTaskSnapshot[] = [];
  const stop = h.owner.observe("book", started.taskId, async snapshot => { seen.push(snapshot); if (seen.length === 1) await gate.promise; });
  for (let completed = 0; completed < 30; completed++) h.work[0]!.options.progress?.({ ...state("book", "preparing"), progress: { total: 30, completed, failed: 0, unsupported: 0 } });
  h.work[0]!.result.resolve(state("book", "ready")); await settle();
  expect(seen).toHaveLength(1); gate.resolve(); await settle();
  expect(seen).toHaveLength(2); expect(seen[1]!.status).toBe("completed"); expect(eventCause(seen[1]!)).toBe(actorCause(origin)); expect(seen[1]!.revision).toBeGreaterThan(seen[0]!.revision);
  stop(); stop();
  const failureStop = h.owner.observe("book", started.taskId, () => { throw Error("observer failed"); });
  await settle(); expect(h.warnings).toHaveLength(1); failureStop();
});

test("disposing an actor stops all observers and requests, without reviving handles in a new generation", async () => {
  const lifetime = new AbortController(); const h = harness(lifetime.signal);
  const started = await h.owner.start("book"); const seen: number[] = [];
  h.owner.observe("book", started.taskId, snapshot => { seen.push(snapshot.revision); });
  lifetime.abort(); expect(h.work[0]!.options.signal!.aborted).toBe(true);
  h.work[0]!.result.resolve(state("book", "ready")); await settle(); expect(seen).toHaveLength(1);
  expect(() => h.owner.get("book", started.taskId)).toThrow();
  expect(() => harness().owner.get("book", started.taskId)).toThrow();
  await expect(h.owner.start("book")).rejects.toMatchObject({ code: "library/text-cancelled" });
});

test("active work, terminal history and observer counts are bounded", async () => {
  const h = harness();
  for (let i = 0; i < 16; i++) await h.owner.start("book");
  await expect(h.owner.start("book")).rejects.toMatchObject({ code: "library/text-task-limit" });
  for (const work of h.work) work.result.resolve(state("book", "ready")); await settle();
  const first = h.owner.list("book")[0]!;
  const stops = Array.from({ length: 16 }, () => h.owner.observe("book", first.taskId, () => {}));
  expect(() => h.owner.observe("book", first.taskId, () => {})).toThrow(); for (const stop of stops) stop();
  for (let i = 0; i < 50; i++) { await h.owner.start("book"); h.work.at(-1)!.result.resolve(state("book", "ready")); await settle(); }
  expect(h.owner.list("book")).toHaveLength(64); expect(() => h.owner.get("book", first.taskId)).toThrow();
  h.owner.dispose();
});

test("invalid options and disposal during preflight do not launch work", async () => {
  const h = harness();
  await expect(h.owner.start("book", { rebuild: "yes" } as never)).rejects.toMatchObject({ code: "library/invalid-input" });
  await expect(h.owner.start("book", { unknown: true } as never)).rejects.toMatchObject({ code: "library/invalid-input" });
  const start = h.owner.start("book"); h.owner.dispose();
  await expect(start).rejects.toMatchObject({ code: "library/text-cancelled" }); expect(h.work).toHaveLength(0);
});

test("pause retains the handle, resumes with a new lease, and ignores the old attempt's callbacks", async () => {
  const h = harness(); const started = await h.owner.start("book", { rebuild: true });
  const paused = h.owner.pause("book", started.taskId);
  expect(paused.status).toBe("paused"); expect(h.work[0]!.options.signal!.aborted).toBe(true);
  expect(h.owner.pause("book", started.taskId)).toEqual(paused);
  expect(() => h.owner.resume("other", started.taskId)).toThrow();
  const resumed = h.owner.resume("book", started.taskId);
  expect(resumed).toMatchObject({ status: "running", taskId: started.taskId });
  expect(h.work[1]!.options.rebuild).toBe(true); // Initial reset never happened.
  expect(h.work[1]!.options.signal!.aborted).toBe(false);
  h.work[0]!.options.progress?.(state("book", "error"));
  h.work[0]!.result.resolve(state("book", "ready")); await settle();
  expect(h.owner.get("book", started.taskId)).toEqual(resumed);
  h.work[1]!.options.onRebuildReset?.();
  h.owner.pause("book", started.taskId); h.owner.resume("book", started.taskId);
  expect(h.work[2]!.options.rebuild).toBe(false); // Preserve successful checkpoints.
  h.work[1]!.result.reject(Error("Old error")); await settle();
  expect(h.warnings).toHaveLength(0);
  h.work[2]!.result.resolve(state("book", "ready")); await settle();
  const completed = h.owner.get("book", started.taskId);
  expect(completed.status).toBe("completed");
  expect(h.owner.pause("book", started.taskId)).toEqual(completed);
  expect(h.owner.resume("book", started.taskId)).toEqual(completed);
});

test("paused handles still consume the bounded live quota and can be cancelled or retired", async () => {
  const lifetime = new AbortController(), h = harness(lifetime.signal);
  for (let i = 0; i < 16; i++) { const task = await h.owner.start("book"); h.owner.pause("book", task.taskId); }
  await expect(h.owner.start("book")).rejects.toMatchObject({ code: "library/text-task-limit" });
  const first = h.owner.list("book")[0]!;
  expect(h.owner.cancel("book", first.taskId).status).toBe("cancelled");
  expect(h.owner.resume("book", first.taskId).status).toBe("cancelled");
  await h.owner.start("book");
  lifetime.abort();
  expect(() => h.owner.resume("book", first.taskId)).toThrow();
});

test("priority changes preserve the same lease and checkpoints; waiting reasons clear on pause and ignore old runs", async () => {
  const h = harness(); const started = await h.owner.start("book", { priority: "background" });
  expect(started.priority).toBe("background"); expect(h.work[0]!.options.priority!()).toBe("background");
  h.work[0]!.options.scheduling!("reader"); expect(h.owner.get("book", started.taskId).waitReason).toBe("reader");
  const promoted = h.owner.setPriority("book", started.taskId, "normal");
  expect(promoted.priority).toBe("normal"); expect(h.work).toHaveLength(1); expect(h.work[0]!.options.priority!()).toBe("normal");
  expect(() => h.owner.setPriority("other", started.taskId, "background")).toThrow();
  expect(() => h.owner.setPriority("book", started.taskId, "urgent" as never)).toThrow();
  expect(h.owner.pause("book", started.taskId).waitReason).toBeNull();
  h.owner.setPriority("book", started.taskId, "background"); h.owner.resume("book", started.taskId);
  h.work[0]!.options.scheduling!("queue"); expect(h.owner.get("book", started.taskId).waitReason).toBeNull();
  expect(h.work[1]!.options.priority!()).toBe("background");
  h.work[1]!.result.resolve(state("book", "ready")); await settle();
  expect(h.owner.setPriority("book", started.taskId, "normal").priority).toBe("background");
  await expect(h.owner.start("book", { priority: "urgent" } as never)).rejects.toMatchObject({ code: "library/invalid-input" });
  h.owner.dispose();
});

test("request timeout releases only that lease, preserves checkpoints and cannot be overwritten by late success", async () => {
  const h = harness(); const first = await h.owner.start("book", { timeoutMs: 1000 });
  const sibling = await h.owner.start("book");
  const progress = { ...state("book", "preparing"), progress: { total: 50, completed: 25, failed: 0, unsupported: 0 } };
  h.work[0]!.options.progress!(progress);
  const seen: BookTextTaskSnapshot[] = [];
  h.owner.observe("book", first.taskId, value => { seen.push(value); });
  await Bun.sleep(1050);
  const expired = h.owner.get("book", first.taskId);
  expect(expired).toMatchObject({ status: "failed", errorCode: "library/text-timeout", textState: { progress: { completed: 25 } } });
  expect(h.work[0]!.options.signal!.aborted).toBe(true); expect(h.work[1]!.options.signal!.aborted).toBe(false);
  expect(seen.at(-1)!.status).toBe("failed");
  h.work[0]!.result.resolve(state("book", "ready")); await settle(); expect(h.owner.get("book", first.taskId)).toEqual(expired);
  expect(h.owner.resume("book", first.taskId)).toEqual(expired);
  expect(h.owner.get("book", sibling.taskId).status).toBe("running"); h.owner.dispose();
});

test("paused time counts toward the deadline and malformed time limits never admit a task", async () => {
  const h = harness();
  for (const timeoutMs of [null, 0, 999, 7200001, 1.5, NaN, "1000"]) await expect(h.owner.start("book", { timeoutMs } as never)).rejects.toMatchObject({ code: "library/invalid-input" });
  expect(h.work).toHaveLength(0);
  const task = await h.owner.start("book", { timeoutMs: 1000 }); h.owner.pause("book", task.taskId);
  await Bun.sleep(1050);
  expect(h.owner.list("book")[0]).toMatchObject({ status: "failed", errorCode: "library/text-timeout", timeoutMs: 1000 });
  expect(Date.parse(task.deadlineAt) - Date.parse(task.createdAt)).toBe(1000); h.owner.dispose();
});

test("a request does not parse before durable history admission and stop during admission cannot launch it", async () => {
  const { BookTextTaskHistory } = await import("./book-text-task-history");
  for (const stop of [false, true]) {
    const gate = deferred<void>(); let raw: string | null = null, parses = 0;
    const history = new BookTextTaskHistory(crypto.randomUUID(), { read: async () => raw,
      write: async value => { await gate.promise; raw = value; }, run: operation => operation() });
    const owner = new BookTextTaskOwner({ snapshot: async () => state(), prepare: async () => { parses++; return state("book", "ready"); } }, () => {}, undefined, history);
    const start = owner.start("book").catch(e => e); await settle(); expect(parses).toBe(0);
    if (stop) owner.dispose(); gate.resolve();
    const receipt = await start; await settle();
    expect(parses).toBe(stop ? 0 : 1);
    if (stop) expect(receipt).toMatchObject({ code: "library/text-cancelled" });
    else expect((await owner.listHistory("book")).items[0]).toMatchObject({ snapshot: { status: "completed" } });
    owner.dispose();
  }
});

test("completed extraction exposes failed history persistence and an explicit history read retries the metadata", async () => {
  const { BookTextTaskHistory } = await import("./book-text-task-history");
  let raw: string | null = null, failure = false;
  const done = deferred<BookTextSnapshot>();
  const history = new BookTextTaskHistory(crypto.randomUUID(), { read: async () => raw,
    write: async value => { if (failure) throw new AppError("db/locked", "History not saved"); raw = value; }, run: operation => operation() });
  const owner = new BookTextTaskOwner({ snapshot: async () => state(), prepare: async () => done.promise }, () => {}, undefined, history);
  const origin = causalActor("plugin:text-history");
  const task = await owner.start("book", {}, origin); await settle(); failure = true;
  done.resolve(state("book", "ready")); await settle();
  expect(owner.get("book", task.taskId)).toMatchObject({ status: "completed", history: { status: "failed", errorCode: "db/locked" } });
  await expect(owner.listHistory("book")).rejects.toMatchObject({ code: "db/locked" });
  failure = false; expect((await owner.listHistory("book")).items[0]!.snapshot.status).toBe("completed");
  expect(owner.get("book", task.taskId).history?.status).toBe("saved");
  expect(eventCause(owner.get("book", task.taskId))).toBe(actorCause(origin)); owner.dispose();
});


test("pause and resume found by listing cannot bypass the durable admission receipt", async () => {
  const { BookTextTaskHistory } = await import("./book-text-task-history");
  for (const resume of [false, true]) {
    const gate = deferred<void>(); let raw: string | null = null, parses = 0;
    const history = new BookTextTaskHistory(crypto.randomUUID(), { read: async () => raw,
      write: async value => { await gate.promise; raw = value; }, run: operation => operation() });
    const owner = new BookTextTaskOwner({ snapshot: async () => state(), prepare: async () => { parses++; return state("book", "ready"); } }, () => {}, undefined, history);
    const start = owner.start("book"); await settle();
    const task = owner.list("book")[0]!; owner.pause("book", task.taskId);
    if (resume) owner.resume("book", task.taskId);
    await settle(); expect(parses).toBe(0); gate.resolve(); await start; await settle();
    expect(parses).toBe(resume ? 1 : 0);
    expect(owner.get("book", task.taskId).status).toBe(resume ? "completed" : "paused"); owner.dispose();
  }
});

test("condition queries share capacity and source checks without task/history side effects", async () => {
  let prepares = 0, writes = 0, sourceReads = 0;
  const owner = new BookTextTaskOwner({ snapshot: async book => state(book), prepare: async () => { prepares++; return new Promise(() => {}); },
    preparationConditions: async () => { sourceReads++; return [{ kind: "provider", state: "unknown", reason: "not-loaded" }]; },
  }, () => {}, undefined, { record: async () => { writes++; } } as never);
  try {
    const available = await owner.conditions("book");
    expect(available).toContainEqual({ kind: "capacity", state: "satisfied", reason: "text-task-capacity" });
    expect(owner.list("book")).toEqual([]); expect(prepares).toBe(0); expect(writes).toBe(0);
    for (let i = 0; i < 16; i++) await owner.start("book");
    const before = { writes, sourceReads };
    expect(await owner.conditions("book")).toEqual([{ kind: "capacity", state: "unavailable", reason: "text-task-limit", errorCode: "library/text-task-limit" }]);
    await expect(owner.start("book")).rejects.toMatchObject({ code: "library/text-task-limit" });
    expect({ writes, sourceReads }).toEqual(before); expect(prepares).toBe(16);
  } finally { owner.dispose(); }
});

test("scope cancellation before admission or during initial history never starts extraction; live scopes release at terminal state", async () => {
  for (const phase of ["source", "snapshot", "history", "running", "paused", "completed"] as const) {
    const gate = Promise.withResolvers<void>(), work = Promise.withResolvers<ReturnType<typeof state>>();
    const abort = new AbortController(); let prepares = 0, releases = 0, disposed = false;
    const access = { signal: abort.signal, isAllowed: () => !disposed && !abort.signal.aborted,
      dispose: () => { if (!disposed) { disposed = true; releases++; } } };
    const owner = new BookTextTaskOwner({
      preparationConditions: async () => { if (phase === "source") await gate.promise; return []; },
      snapshot: async () => { if (phase === "snapshot") await gate.promise; return state(); },
      prepare: async (_book, options) => { prepares++; options?.signal?.addEventListener("abort", () => work.reject(options.signal!.reason), { once: true }); return work.promise; },
    }, () => {}, undefined, { record: async () => { if (phase === "history") await gate.promise; } } as never);
    try {
      const start = owner.start("book", {}, "plugin:scoped", access);
      await Bun.sleep(0);
      if (["source", "snapshot", "history"].includes(phase)) {
        abort.abort(new AppError("plugin/object-access-denied", "Reader changed")); gate.resolve();
        await expect(start).rejects.toMatchObject({ code: "plugin/object-access-denied" }); expect(prepares).toBe(0);
        expect(owner.list("book").every(task => task.status === "cancelled")).toBe(true);
      } else {
        const task = await start; expect(prepares).toBe(1);
        if (phase === "completed") { work.resolve(state("book", "ready")); await Bun.sleep(0); }
        if (phase === "paused") owner.pause("book", task.taskId);
        if (phase !== "completed") expect(releases).toBe(0);
        abort.abort(new AppError("plugin/object-access-denied", "Reader changed")); await Bun.sleep(0);
        expect(owner.get("book", task.taskId).status).toBe(phase === "completed" ? "completed" : "cancelled");
      }
      expect(releases).toBe(1);
    } finally { gate.resolve(); owner.dispose(); }
  }
});


test("expiry notifications cannot admit a new scoped task after the consumer changes books", async () => {
  const before = Date.now(), clock = spyOn(Date, "now").mockReturnValue(before);
  const abort = new AbortController(); const written: string[] = [];
  const owner = new BookTextTaskOwner({ snapshot: async book => state(book), prepare: async () => new Promise(() => {}) }, () => {}, undefined,
    { record: async (task: BookTextTaskSnapshot) => { written.push(task.bookId); } } as never);
  try {
    const old = await owner.start("old", { timeoutMs: 1000 });
    owner.observe("old", old.taskId, task => { if (task.status === "failed") abort.abort(new AppError("plugin/object-access-denied", "Reader changed")); });
    clock.mockReturnValue(before + 2000);
    await expect(owner.start("new", {}, "plugin:scoped", { signal: abort.signal, isAllowed: () => !abort.signal.aborted, dispose() {} }))
      .rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect(written).not.toContain("new"); expect(owner.list("new")).toEqual([]);
  } finally { clock.mockRestore(); owner.dispose(); }
});
