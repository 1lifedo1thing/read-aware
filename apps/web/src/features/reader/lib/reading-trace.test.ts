import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { ReadingSessionBucket, SessionPosition } from "../../../platform/reading-session";
import { bucketKeyAt } from "./reading-session-policy";
import { ReadingTraceCoordinator } from "./reading-trace";

const at = new Date(2026, 8, 10, 12, 1).getTime();
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

function fixture() {
  let pending: ReadingSessionBucket[] = [];
  const events: ReadingSessionBucket[] = [], errors: unknown[] = [];
  const bucket = (bookId: string, time: number) => {
    const key = bucketKeyAt(bookId, time);
    let value = pending.find(b => b.bookId === bookId && b.localDay === key.localDay && b.localHour === key.localHour);
    if (!value) { value = { ...key, ms: 0, startedAt: time, lastAt: time, progress: null, positionAt: null }; pending.push(value); }
    return value;
  };
  const store = {
    accrue: async (bookId: string, ms: number, time: number) => { bucket(bookId, time).ms += ms; },
    position: async (bookId: string, progress: SessionPosition, time: number) => {
      const b = bucket(bookId, time); b.progress = progress; b.positionAt = time;
    },
    pending: async () => structuredClone(pending),
    flush: async (buckets: ReadingSessionBucket[]) => {
      events.push(...structuredClone(buckets));
      pending = pending.filter(b => !buckets.some(c => c.bookId === b.bookId && c.localDay === b.localDay && c.localHour === b.localHour));
    },
    report: (error: unknown) => { errors.push(error); },
  };
  return { coordinator: new ReadingTraceCoordinator(store), store, events, errors };
}

test("retirement joins delayed time and position writes and rejects late callbacks", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const original = f.store.accrue;
  f.store.accrue = async (...args) => { entered.resolve(); await gate.promise; await original(...args); };
  const trace = f.coordinator.begin("session", "book");
  trace.accrue(2000, at);
  const position = { locator: "accepted" };
  trace.position(position, at); position.locator = "mutated";
  const unbind = trace.bindSampler(() => trace.accrue(1000, at));
  let done = false;
  const close = trace.retire().then(() => { done = true; });
  await entered.promise;
  expect(done).toBe(false); expect(trace.accepting).toBe(false);
  trace.accrue(999, at); trace.position({ locator: "late" }, at); unbind();
  gate.resolve(); await close;
  expect(f.events).toHaveLength(1);
  expect(f.events[0]).toMatchObject({ ms: 3000, progress: { locator: "accepted" } });
  expect(await f.store.pending()).toEqual([]);
  await trace.retire(); expect(f.events).toHaveLength(1);
});

test("view remount transfers sampling without closing the session", async () => {
  const f = fixture(), trace = f.coordinator.begin("s1", "book");
  const old = trace.bindSampler(() => trace.accrue(1000, at));
  old();
  expect(trace.accepting).toBe(true);
  trace.bindSampler(() => trace.accrue(2000, at));
  old();
  await trace.retire();
  expect(f.events).toHaveLength(1); expect(f.events[0].ms).toBe(3000);
});

test("rapid same-book replacement serializes old retirement before new writes", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const original = f.store.position;
  f.store.position = async (...args) => { entered.resolve(); await gate.promise; await original(...args); };
  const old = f.coordinator.begin("s1", "book"); old.position({ locator: "old" }, at);
  await entered.promise;
  const next = f.coordinator.begin("s2", "book"); next.position({ locator: "new" }, at);
  old.position({ locator: "late old" }, at);
  gate.resolve(); await next.retire();
  expect(f.events.map(b => b.progress?.locator)).toEqual(["old", "new"]);
  expect(await f.store.pending()).toEqual([]);
});

test("retirement and hour rollover flush only the owned book", async () => {
  const f = fixture(); await f.store.accrue("unrelated", 9000, at);
  const trace = f.coordinator.begin("s", "book");
  trace.accrue(1000, at); trace.position({ locator: "next hour" }, at + 3600000);
  await trace.retire();
  expect(f.events.map(b => b.bookId)).toEqual(["book", "book"]);
  expect((await f.store.pending()).map(b => b.bookId)).toEqual(["unrelated"]);
});

test("write failure cannot be hidden by successful final flush or poison the next session", async () => {
  const f = fixture(), error = new AppError("db/locked", "fixture");
  const original = f.store.accrue;
  f.store.accrue = async () => { throw error; };
  const trace = f.coordinator.begin("s1", "book"); trace.accrue(1000, at);
  await expect(trace.retire()).rejects.toBe(error);
  expect(f.errors).toContain(error);
  f.store.accrue = original;
  const next = f.coordinator.begin("s2", "other"); next.accrue(2000, at);
  await next.retire(); expect(f.events[0].ms).toBe(2000);
});

test("flush failure retains buckets and still banks new observations", async () => {
  const f = fixture(), error = new AppError("db/locked", "fixture");
  await f.store.accrue("book", 1000, at);
  f.store.flush = async () => { throw error; };
  const trace = f.coordinator.begin("s", "book"); trace.accrue(2000, at + 3600000);
  await expect(trace.retire()).rejects.toBe(error);
  expect((await f.store.pending()).map(b => b.ms)).toEqual([1000, 2000]);
  expect(f.errors).toContain(error);
});

test("settle retires the live session and waits for every queued flush before resolving", async () => {
  const f = fixture(), coordinator = new ReadingTraceCoordinator(f.store);
  await coordinator.settle();
  const trace = coordinator.begin("s1", "book-1");
  trace.accrue(1000, at);
  expect(trace.accepting).toBe(true);
  await coordinator.settle();
  expect(trace.accepting).toBe(false);
  expect(f.events.some(bucket => bucket.bookId === "book-1" && bucket.ms === 1000)).toBe(true);
  expect(coordinator.current("book-1")).toBeUndefined();
});

test("backup samples and drains before entry; later observations and replacement sessions wait without retiring the sampler", async () => {
  const f = fixture(), write = deferred(), entered = deferred(), backup = deferred();
  const original = f.store.accrue;
  f.store.accrue = async (...args) => { entered.resolve(); await write.promise; await original(...args); };
  const trace = f.coordinator.begin("before", "book");
  let samples = 0;
  trace.bindSampler(() => { samples++; trace.accrue(1000, at); });
  let inside = false;
  const capture = f.coordinator.withWritesPaused(async () => {
    inside = true;
    expect((await f.store.pending()).map(b => b.ms)).toEqual([1000]);
    await f.store.flush(await f.store.pending());
    await backup.promise;
    expect(await f.store.pending()).toEqual([]);
    return "captured";
  });
  await entered.promise; expect(inside).toBe(false); expect(samples).toBe(1);
  expect(trace.accepting).toBe(true);
  trace.position({ locator: "during-backup" }, at + 1000);
  write.resolve(); await Bun.sleep(0); expect(inside).toBe(true);
  // Replacement retirement samples again, but that sample also stays queued.
  const next = f.coordinator.begin("after", "other");
  next.accrue(3000, at + 2000);
  const retire = next.retire();
  await Bun.sleep(0); expect(await f.store.pending()).toEqual([]);
  backup.resolve(); expect(await capture).toBe("captured"); await retire;
  expect(f.events.map(b => [b.bookId, b.ms, b.progress?.locator])).toEqual([
    ["book", 1000, undefined], ["book", 1000, "during-backup"], ["other", 3000, undefined],
  ]);
  expect(samples).toBe(2);
});

test("cancellation during drain retains exclusion through physical completion and does not run backup", async () => {
  const f = fixture(), write = deferred(), entered = deferred(), controller = new AbortController();
  const original = f.store.accrue;
  f.store.accrue = async (...args) => { entered.resolve(); await write.promise; await original(...args); };
  const trace = f.coordinator.begin("s", "book"); trace.accrue(1000, at);
  let called = false, finished = false;
  const capture = f.coordinator.withWritesPaused(async () => { called = true; }, controller.signal)
    .catch(error => { finished = true; return error; });
  await entered.promise; controller.abort(new Error("cancelled"));
  trace.position({ locator: "retained" }, at);
  await Bun.sleep(0); expect(finished).toBe(false);
  await expect(f.coordinator.withWritesPaused(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
  write.resolve(); expect((await capture).message).toBe("cancelled"); expect(called).toBe(false);
  await trace.retire(); expect(f.events[0].progress?.locator).toBe("retained");
});

test("drain failure waits for other accepted writes, prevents capture and releases the queue", async () => {
  const f = fixture(), position = deferred(), entered = deferred();
  const failure = new AppError("db/locked", "synthetic");
  f.store.accrue = async () => { throw failure; };
  const original = f.store.position;
  f.store.position = async (...args) => { entered.resolve(); await position.promise; await original(...args); };
  const trace = f.coordinator.begin("s", "book");
  trace.accrue(1000, at); trace.position({ locator: "survives" }, at);
  let called = false, finished = false;
  const capture = f.coordinator.withWritesPaused(async () => { called = true; }).catch(error => { finished = true; return error; });
  await entered.promise; expect(finished).toBe(false);
  position.resolve(); expect(await capture).toBe(failure); expect(called).toBe(false);
  const next = f.coordinator.begin("next", "other"); next.position({ locator: "next" }, at);
  await next.retire(); expect(f.events.map(b => b.progress?.locator)).toEqual(["survives", "next"]);
});

test("operation failure and cancellation preserve the sampler and release only after the operation settles", async () => {
  const f = fixture(), trace = f.coordinator.begin("s", "book"), gate = deferred();
  let samples = 0; trace.bindSampler(() => { samples++; });
  const controller = new AbortController();
  const capture = f.coordinator.withWritesPaused(async () => {
    await expect(f.coordinator.withWritesPaused(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
    await gate.promise; return 42;
  }, controller.signal);
  await Bun.sleep(0); controller.abort(); trace.accrue(2000, at);
  await Bun.sleep(0); expect(await f.store.pending()).toEqual([]);
  gate.resolve(); expect(await capture).toBe(42);
  await expect(f.coordinator.withWritesPaused(async () => { throw new Error("capture failed"); })).rejects.toThrow("capture failed");
  expect(trace.accepting).toBe(true); await trace.retire(); expect(samples).toBe(3);
  expect(f.events[0].ms).toBe(2000);
  await expect(f.coordinator.withWritesPaused(async () => {}, controller.signal)).rejects.toThrow();
});
