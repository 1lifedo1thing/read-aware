import { expect, test } from "bun:test";
import { AppError, type BookImportReceipt, type BookImportTaskSnapshot } from "@read-aware/core";
import { BookImportTaskOwner } from "./book-import-tasks";

const receipt: BookImportReceipt = { status: "duplicate", book: { id: "existing", title: "Existing", format: "txt", starred: false,
  collectionId: null, addedAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z" } };
const tick = () => Bun.sleep(0);

test.each(["completed", "failed"])("accepted imports retain their %s result after cancellation and keep physical capacity", async phase => {
  const gate = Promise.withResolvers<void>(), errors: unknown[] = [];
  const owner = new BookImportTaskOwner(error => errors.push(error));
  let received!: AbortSignal;
  const execute = async (signal: AbortSignal, progress: (phase: "staging" | "committing") => void) => {
    received = signal; progress("staging"); await gate.promise; progress("committing");
    if (phase === "failed") throw new AppError("db/locked", "Native failure after acceptance");
    return receipt;
  };
  const first = owner.start("book.txt", execute), second = owner.start("other.txt", execute);
  try {
    expect(first.phase).toBe("queued"); await tick();
    expect(owner.cancel(first.taskId)).toMatchObject({ phase: "staging", cancellable: false, cancelRequested: true });
    owner.cancel(second.taskId); expect(received.aborted).toBe(true);
    expect(() => owner.start("third.txt", execute)).toThrow("capacity");
    gate.resolve(); await owner.drain();
    const result = owner.get(first.taskId);
    expect(result).toMatchObject({ phase, cancelRequested: true, cancellable: false,
      errorCode: phase === "failed" ? "db/locked" : null, receipt: phase === "failed" ? null : receipt });
    if (result.receipt) result.receipt.book.title = "Forged";
    expect(owner.get(first.taskId).receipt?.book.title).not.toBe("Forged");
    expect(owner.cancel(first.taskId)).toEqual(owner.get(first.taskId));
  } finally { gate.resolve(); owner.dispose(); await owner.drain(); }
});

test("queued cancellation prevents dispatch; preparation cancellation waits for the source before becoming terminal", async () => {
  const owner = new BookImportTaskOwner(() => {}), gate = Promise.withResolvers<void>(); let calls = 0;
  const queued = owner.start("queued.txt", async () => { calls++; return receipt; }); owner.cancel(queued.taskId);
  await owner.drain(); expect(calls).toBe(0); expect(owner.get(queued.taskId).phase).toBe("cancelled");
  const preparing = owner.start("preparing.txt", async (signal, progress) => {
    calls++; progress("preparing"); await gate.promise; signal.throwIfAborted(); return receipt;
  });
  await tick(); owner.cancel(preparing.taskId);
  expect(owner.get(preparing.taskId)).toMatchObject({ phase: "preparing", cancelRequested: true });
  gate.resolve(); await owner.drain(); expect(owner.get(preparing.taskId)).toMatchObject({ phase: "cancelled", receipt: null });
  owner.dispose();
});

test("observers coalesce revisions, cannot change stored receipts, and stop at actor retirement", async () => {
  const owner = new BookImportTaskOwner(() => {}), source = Promise.withResolvers<void>(), observer = Promise.withResolvers<void>();
  const task = owner.start("book.txt", async (_signal, progress) => { progress("preparing"); progress("staging"); await source.promise; progress("committing"); return receipt; });
  const seen: BookImportTaskSnapshot[] = [];
  owner.observe(task.taskId, async value => { seen.push(value); if (seen.length === 1) await observer.promise; });
  await tick(); source.resolve(); await owner.drain(); expect(seen).toHaveLength(1);
  observer.resolve(); await tick(); expect(seen.map(item => item.phase)).toEqual(["queued", "completed"]);
  expect(seen[1].revision).toBeGreaterThan(seen[0].revision);
  seen[1].receipt!.book.title = "Changed"; expect(owner.get(task.taskId).receipt!.book.title).toBe("Existing");
  const count = seen.length; owner.dispose(); await tick(); expect(seen).toHaveLength(count);
  expect(() => owner.get(task.taskId)).toThrow("cancelled");
});

test("global capacity is shared across actors until execution settles; handles are isolated and terminal retention is bounded", async () => {
  const gate = Promise.withResolvers<void>(), owners = Array.from({ length: 3 }, () => new BookImportTaskOwner(() => {}));
  const execute = async () => { await gate.promise; return receipt; };
  const tasks = owners.slice(0, 2).flatMap(owner => [owner.start("a.txt", execute), owner.start("b.txt", execute)]);
  try {
    expect(() => owners[2].get(tasks[0].taskId)).toThrow("No import task");
    expect(() => owners[2].start("blocked.txt", execute)).toThrow("capacity");
    await tick(); owners[0].dispose();
    expect(() => owners[2].start("still-blocked.txt", execute)).toThrow("capacity");
    gate.resolve(); await Promise.all(owners.map(owner => owner.drain()));
    const oldest = owners[2].start("first.txt", execute); await owners[2].drain();
    for (let i = 0; i < 64; i++) { owners[2].start(`file-${i}.txt`, execute); await owners[2].drain(); }
    expect(owners[2].list()).toHaveLength(64); expect(() => owners[2].get(oldest.taskId)).toThrow("No import task");
  } finally { gate.resolve(); for (const owner of owners) owner.dispose(); await Promise.all(owners.map(owner => owner.drain())); }
});

test("retirement cancels queued admission, detaches observers and drains accepted execution", async () => {
  const life = new AbortController(), gate = Promise.withResolvers<void>(); let called = false;
  const owner = new BookImportTaskOwner(() => {}, life.signal);
  const queued = owner.start("queued.txt", async () => { called = true; return receipt; });
  life.abort(); await owner.drain(); expect(called).toBe(false);
  expect(() => owner.get(queued.taskId)).toThrow();
  const activeLife = new AbortController(), active = new BookImportTaskOwner(() => {}, activeLife.signal);
  const task = active.start("accepted.txt", async (_signal, progress) => { progress("staging"); await gate.promise; return receipt; });
  await tick(); const seen: string[] = []; active.observe(task.taskId, state => { seen.push(state.phase); }); activeLife.abort();
  let drained = false; const draining = active.drain().then(() => { drained = true; });
  await tick(); expect(drained).toBe(false); gate.resolve(); await draining; expect(seen).toEqual(["staging"]);
});

test("bounded waits return progress at deadlines, release observers on cancellation and never cancel the job", async () => {
  const owner = new BookImportTaskOwner(() => {}), gate = Promise.withResolvers<void>(); let executionSignal!: AbortSignal;
  const task = owner.start("slow.txt", async (signal, progress) => { executionSignal = signal; progress("staging"); await gate.promise; return receipt; });
  try {
    expect((await owner.wait(task.taskId, 1)).phase).toBe("staging");
    const caller = new AbortController(), reason = new Error("Stop waiting");
    const waiting = owner.wait(task.taskId, 30_000, caller.signal); caller.abort(reason);
    await expect(waiting).rejects.toBe(reason); expect(executionSignal.aborted).toBe(false);
    const observers = Array.from({ length: 16 }, () => owner.observe(task.taskId, () => {}));
    await expect(owner.wait(task.taskId, 30_000)).rejects.toMatchObject({ code: "ui/observer-limit" });
    for (const stop of observers) stop();
    const finished = owner.wait(task.taskId, 30_000); gate.resolve();
    expect((await finished).phase).toBe("completed"); await owner.drain();
    expect(() => owner.wait(task.taskId, 30_001)).toThrow("duration");
  } finally { gate.resolve(); owner.dispose(); await owner.drain(); }
});
