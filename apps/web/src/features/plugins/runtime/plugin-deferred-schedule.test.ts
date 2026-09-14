import { actorCause, causalActor, eventCause, reactionActor } from "../../../platform/domain-actor";
import { expect, test } from "bun:test";
import { AppError, type PluginDeferredRequest, type PluginScheduleRun } from "@read-aware/core";
import { PluginScheduleController, type ScheduleRecord } from "./plugin-schedule-controller";

const declaration = { id: "work", label: "Work", mode: "deferred" as const };
const input = (requestId = "one", when: "any" | "idle" = "any"): PluginDeferredRequest => ({ requestId, delayMs: 1000, when });
const settle = () => Bun.sleep(0);
function fixture() {
  let now = 10_000, fail = false, beforeWrite: (() => Promise<void>) | undefined;
  const disk = new Map<string, Record<string, ScheduleRecord>>(), errors: unknown[] = [], runs: PluginScheduleRun[] = [];
  let writes = 0;
  const storage = { read: (id: string) => structuredClone(disk.get(id) ?? {}), write: async (id: string, record: Record<string, ScheduleRecord>) => {
    await beforeWrite?.(); if (fail) throw new AppError("db/locked", "locked"); writes++; disk.set(id, structuredClone(record));
  } };
  const make = () => new PluginScheduleController(storage, error => errors.push(error), () => now);
  const controller = make();
  return { controller, make, runs, errors, disk, bind: (version = "1.0.0") => controller.register("test", declaration, context => { runs.push(context); }, version),
    advance: (ms = 1000) => { now += ms; }, fail: (value: boolean) => { fail = value; }, block: (value?: () => Promise<void>) => { beforeWrite = value; }, get writes() { return writes; } };
}

test("deferred work requires enqueue, preserves its exact receipt, waits for due and idle, and does not replay completion", async () => {
  const f = fixture(), binding = f.bind();
  f.controller.sweep(true); await settle(); expect(f.runs).toEqual([]);
  const first = await f.controller.defer("test", "work", input("one", "idle"));
  expect(first).toMatchObject({ status: "queued", request: { dueAt: 11_000, ownerVersion: "1.0.0", state: "queued" } });
  expect(await f.controller.defer("test", "work", input("one", "idle"))).toEqual({ ...first, status: "retained" });
  expect(f.writes).toBe(1);
  f.controller.sweep(true); await settle(); expect(f.runs).toEqual([]);
  f.advance(); f.controller.sweep(false); await settle(); expect(f.runs).toEqual([]);
  f.controller.sweep(true); await settle();
  expect(f.runs).toEqual([{ trigger: "deferred", requestId: "one", startedAt: 11_000 }]);
  expect((await f.controller.defer("test", "work", input("one", "idle"))).request?.state).toBe("succeeded");
  f.advance(); f.controller.sweep(true); await settle(); expect(f.runs).toHaveLength(1);
  binding.dispose();
});

test("queued work survives rebind and restart; changed plugin versions do not inherit old deferred intent", async () => {
  const f = fixture(), binding = f.bind(), origin = reactionActor("plugin:test", "schedule:work", actorCause(causalActor("user"))!);
  await f.controller.defer("test", "work", input(), undefined, origin); binding.dispose(); f.advance();
  const restored = f.make(); restored.register("test", declaration, context => { f.runs.push(context); });
  restored.sweep(); await settle(); expect(f.runs).toHaveLength(1);
  expect(eventCause(f.runs[0]!)).toEqual(actorCause(origin));
  expect(JSON.stringify(restored.list())).not.toContain("deferredSource");
  await restored.defer("test", "work", input("two"));
  const upgraded = f.make(); upgraded.register("test", declaration, () => { throw Error("Old task dispatched to new code"); }, "2.0.0");
  f.advance(); upgraded.sweep(true); await settle();
  expect(upgraded.list().schedules[0]?.deferred).toMatchObject({ state: "cancelled", errorCode: "ui/superseded" });
  expect((await upgraded.defer("test", "work", input("two"))).request?.state).toBe("cancelled");
  expect((await upgraded.defer("test", "work", input("three"))).status).toBe("queued");
});

test("queue admission is serialized, immutable, owner-scoped and cancels only the named pending request", async () => {
  const f = fixture(); f.bind();
  const raw = input(), queued = f.controller.defer("test", "work", raw); raw.delayMs = 9999;
  await expect(f.controller.defer("test", "work", input("two"))).rejects.toMatchObject({ code: "plugin/busy" });
  expect((await queued).request?.delayMs).toBe(1000);
  await expect(f.controller.defer("test", "work", raw)).rejects.toMatchObject({ code: "ui/superseded" });
  await expect(f.controller.defer("other", "work", input())).rejects.toMatchObject({ code: "ui/unavailable" });
  expect((await f.controller.cancelDeferred("test", "work", "two")).status).toBe("not-queued");
  expect((await f.controller.cancelDeferred("test", "work", "one")).status).toBe("cancelled");
  expect((await f.controller.defer("test", "work", input())).request?.state).toBe("cancelled");
  f.advance(); f.controller.sweep(true); await settle(); expect(f.runs).toEqual([]);
});

test("callback rearming does not overlap or get overwritten by the previous finish", async () => {
  const f = fixture(); let finish!: () => void;
  f.controller.register("test", declaration, async context => {
    f.runs.push(context);
    if (context.requestId === "one") { await f.controller.defer("test", "work", input("two")); await new Promise<void>(resolve => { finish = resolve; }); }
  });
  await f.controller.defer("test", "work", input()); f.advance(); f.controller.sweep(); await settle();
  f.advance(); f.controller.sweep(); await settle(); expect(f.runs).toHaveLength(1);
  finish(); await settle(); expect(f.controller.list().schedules[0]?.deferred).toMatchObject({ requestId: "two", state: "queued" });
  f.controller.sweep(); await settle(); expect(f.runs.map(run => run.requestId)).toEqual(["one", "two"]);
});

test("failed/interrupted deferred work is inspectable, not automatically retried; manual run consumes a paused pending request", async () => {
  const f = fixture(); f.controller.register("test", declaration, () => { throw new AppError("sync/network", "offline"); });
  await f.controller.defer("test", "work", input()); f.advance(); f.controller.sweep(); await settle();
  expect(f.controller.list().schedules[0]?.deferred).toMatchObject({ state: "failed", errorCode: "sync/network" });
  f.advance(); f.controller.sweep(); await settle(); expect(f.errors).toHaveLength(2);
  f.disk.get("test")!.work!.deferred!.state = "running";
  const restarted = f.make(); restarted.register("test", declaration, context => { f.runs.push(context); });
  restarted.sweep(); await settle(); expect(f.runs).toHaveLength(0);
  expect(restarted.list().schedules[0]?.deferred?.state).toBe("interrupted");
  await restarted.defer("test", "work", input("two"));
  await restarted.control({ pluginId: "test", id: "work", action: "pause" });
  await restarted.control({ pluginId: "test", id: "work", action: "run" });
  expect(f.runs).toMatchObject([{ trigger: "manual", requestId: "two" }]);
  expect(restarted.list().schedules[0]).toMatchObject({ paused: true, deferred: { state: "succeeded" } });
});

test("cancel before dispatch writes nothing; cancellation/retirement after persistence begins drains its real result", async () => {
  const f = fixture(), binding = f.bind();
  await expect(f.controller.defer("test", "work", input(), AbortSignal.abort())).rejects.toThrow(); expect(f.writes).toBe(0);
  let release!: () => void; f.block(() => new Promise<void>(resolve => { release = resolve; }));
  const abort = new AbortController(), pending = f.controller.defer("test", "work", input(), abort.signal);
  await settle(); abort.abort(); binding.dispose();
  let drained = false; const drain = f.controller.drainWrites("test").then(() => { drained = true; });
  await settle(); expect(drained).toBe(false); release();
  expect((await pending).status).toBe("queued"); await drain; expect(drained).toBe(true);
  expect(f.disk.get("test")?.work?.deferred?.state).toBe("queued");
});

test("durable enqueue/start failures do not dispatch callbacks or pretend the request succeeded", async () => {
  const f = fixture(); f.bind(); f.fail(true);
  await expect(f.controller.defer("test", "work", input())).rejects.toMatchObject({ code: "db/locked" });
  expect(f.controller.list().schedules[0]?.deferred).toBeNull();
  f.fail(false); await f.controller.defer("test", "work", input()); f.advance(); f.fail(true); f.controller.sweep(); await settle();
  expect(f.runs).toEqual([]); expect(f.controller.list().schedules[0]?.deferred?.state).toBe("queued");
  f.fail(false); f.controller.sweep(); await settle(); expect(f.runs).toHaveLength(1);
});

test("shared capacity is held until callbacks settle, and automatic sweeps rotate rather than starving later tasks", async () => {
  const f = fixture(), completions: (() => void)[] = [], seen: string[] = [];
  for (let index = 0; index < 10; index++) {
    const plugin = `plugin-${index}`;
    f.controller.register(plugin, declaration, async () => { seen.push(plugin); await new Promise<void>(resolve => { completions.push(resolve); }); });
    await f.controller.defer(plugin, "work", input());
  }
  f.advance(); f.controller.sweep(); await settle(); expect(seen).toHaveLength(8);
  await expect(f.controller.control({ pluginId: "plugin-9", id: "work", action: "run" })).rejects.toMatchObject({ code: "plugin/busy" });
  for (const complete of completions.splice(0)) complete(); await settle();
  for (let index = 0; index < 8; index++) await f.controller.defer(`plugin-${index}`, "work", input("two"));
  f.advance(); f.controller.sweep(); await settle(); expect(seen.slice(8, 10)).toEqual(["plugin-8", "plugin-9"]);
  for (const complete of completions.splice(0)) complete(); await settle();
});
