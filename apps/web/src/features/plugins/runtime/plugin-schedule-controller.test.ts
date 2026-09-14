import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { PluginScheduleController, type ScheduleRecord } from "./plugin-schedule-controller";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { withContributionActivation } from "../state/contribution-activation";

const declaration = { id: "refresh", label: "Refresh", everyMinutes: 60 };
const command = (action: "pause" | "resume" | "run") => ({ pluginId: "test", id: "refresh", action });
function fixture() {
  const disk = new Map<string, Record<string, ScheduleRecord>>(), errors: unknown[] = [];
  let now = 1_000_000, fail = false;
  const storage = { read: (id: string) => structuredClone(disk.get(id) ?? {}),
    write: async (id: string, value: Record<string, ScheduleRecord>) => { if (fail) throw new AppError("db/locked", "locked"); disk.set(id, structuredClone(value)); } };
  return { controller: new PluginScheduleController(storage, error => errors.push(error), () => now), storage, disk, errors,
    fail: (value: boolean) => { fail = value; }, advance: () => { now += 3_600_000; } };
}

test("backup freezes controls and periodic dispatch while running completion waits for persistence release", async () => {
  const f = fixture(), callback = Promise.withResolvers<void>(), backup = Promise.withResolvers<void>();
  let called = 0;
  f.controller.register("test", declaration, async () => { called++; await callback.promise; });
  f.controller.register("other", { id: "later", label: "Later", mode: "deferred" }, () => { called++; });
  await f.controller.defer("other", "later", { requestId: "one", delayMs: 1000, when: "any" });
  const execution = f.controller.control(command("run")); await Bun.sleep(0);
  const paused = f.controller.withPersistencePaused(() => backup.promise); await Bun.sleep(0);
  expect(f.controller.conditions(command("run"))).toEqual([{ kind: "capacity", state: "unavailable", reason: "schedule-persistence-paused", errorCode: "backup/busy" }]);

  f.advance(); f.controller.sweep(true); expect(called).toBe(1);
  for (const action of ["pause", "resume", "run"] as const) await expect(f.controller.control(command(action))).rejects.toMatchObject({ code: "backup/busy" });
  await expect(f.controller.defer("other", "later", { requestId: "two", delayMs: 1000, when: "any" })).rejects.toMatchObject({ code: "backup/busy" });
  await expect(f.controller.cancelDeferred("other", "later", "one")).rejects.toMatchObject({ code: "backup/busy" });
  callback.resolve(); await Bun.sleep(0);
  expect(f.disk.get("test")?.refresh?.lastOutcome).toBe("running");
  expect(f.controller.list({ pluginId: "test" }).schedules[0]?.running).toBe(true);
  backup.resolve(); await paused;
  expect((await execution).schedule.lastOutcome).toBe("succeeded");
  expect(f.disk.get("test")?.refresh?.lastOutcome).toBe("succeeded");
  f.controller.sweep(true); await Bun.sleep(0);
  expect(f.controller.list({ pluginId: "other" }).schedules[0]?.deferred?.state).toBe("succeeded");
});

test("a callback can request backup without waiting for itself", async () => {
  const f = fixture(); let captured = false;
  f.controller.register("test", declaration, () => f.controller.withPersistencePaused(async () => {
    expect(f.disk.get("test")?.refresh?.lastOutcome).toBe("running"); captured = true;
  }));
  expect((await f.controller.control(command("run"))).schedule.lastOutcome).toBe("succeeded");
  expect(captured).toBe(true);
});

test("a deferred completion rechecks its retired owner and cannot save after replacement", async () => {
  const f = fixture(), callback = Promise.withResolvers<void>(), backup = Promise.withResolvers<void>();
  const old = f.controller.register("test", declaration, () => callback.promise);
  const execution = f.controller.control(command("run")).catch(error => error); await Bun.sleep(0);
  const paused = f.controller.withPersistencePaused(() => backup.promise); await Bun.sleep(0);
  callback.resolve(); await Bun.sleep(0);
  old.dispose(); f.controller.register("test", declaration, () => {}, "2.0.0");
  backup.resolve(); await paused;
  expect((await execution).code).toBe("plugin/cancelled");
  expect(f.disk.get("test")?.refresh?.lastOutcome).toBe("running");
  expect((await f.controller.control(command("run"))).schedule.lastOutcome).toBe("succeeded");
});

test("cancelled admission still drains dispatched state writes and leaves the controller reusable", async () => {
  const f = fixture(), writing = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const original = f.storage.write;
  f.storage.write = async (...args) => { entered.resolve(); await writing.promise; await original(...args); };
  f.controller.register("test", declaration, () => {});
  const commandResult = f.controller.control(command("pause")); await entered.promise;
  const controller = new AbortController(); let finished = false, called = false;
  const paused = f.controller.withPersistencePaused(async () => { called = true; }, controller.signal)
    .catch(error => { finished = true; return error; });
  controller.abort(new Error("cancelled")); await Bun.sleep(0); expect(finished).toBe(false);
  writing.resolve(); await commandResult;
  expect((await paused).message).toBe("cancelled"); expect(called).toBe(false);
  await expect(f.controller.withPersistencePaused(async () => { throw new Error("capture failed"); })).rejects.toThrow("capture failed");
  expect((await f.controller.control(command("resume"))).schedule.paused).toBe(false);
});

test("failed activation restores the old schedule callback and its in-flight result without overlap", async () => {
  const f = fixture(); let finish!: () => void, oldCalls = 0, newCalls = 0;
  const old = f.controller.register("test", declaration, async () => {
    oldCalls++; if (oldCalls === 1) await new Promise<void>(resolve => { finish = resolve; });
  });
  const pending = f.controller.control(command("run")); await Bun.sleep(0);
  const seen: string[][] = [];
  const off = f.controller.subscribe(() => { seen.push(f.controller.list().schedules.map(task => task.label)); });
  const life = new PluginLifecycleController([]);
  life.stage(() => f.controller.register("test", { ...declaration, label: "Candidate" }, () => { newCalls++; }, "2.0.0"));
  life.stage(() => { throw new Error("Later registration failed"); });
  expect(() => life.promote()).toThrow("Later registration failed");
  expect(seen).toEqual([["Refresh"]]);
  expect((await f.controller.control(command("run"))).status).toBe("already-running");
  finish(); expect((await pending).schedule.lastOutcome).toBe("succeeded");
  life.stop(); await f.controller.control(command("run"));
  expect(oldCalls).toBe(2); expect(newCalls).toBe(0);
  old.dispose(); off(); expect(f.controller.inspect()).toEqual([]);
});

test("nested rollback restores binding metadata and queued intent; explicit old disposal stays retired", async () => {
  const f = fixture(), deferred = { id: "refresh", label: "Deferred", mode: "deferred" as const };
  const old = f.controller.register("test", deferred, () => {}, "1.0.0");
  await f.controller.defer("test", "refresh", { requestId: "one", delayMs: 1000, when: "idle" });
  const original = f.controller.list();
  expect(() => withContributionActivation(() => {
    f.controller.register("test", declaration, () => {}, "2.0.0");
    expect(() => withContributionActivation(() => {
      f.controller.register("test", { ...declaration, label: "Child" }, () => {}, "3.0.0");
      throw new Error("Child failed");
    })).toThrow("Child failed");
    expect(f.controller.list().schedules[0].label).toBe("Refresh");
    throw new Error("Outer failed");
  })).toThrow("Outer failed");
  expect(f.controller.list()).toEqual(original);
  const life = new PluginLifecycleController([]);
  life.stage(() => f.controller.register("test", declaration, () => {}));
  life.stage(() => { old.dispose(); throw new Error("Old already disposed"); });
  expect(() => life.promote()).toThrow("Old already disposed");
  expect(f.controller.inspect()).toEqual([]); life.stop();
});

test("successful replacement survives stale disposal and a factory failure before returning leaves no binding", () => {
  const f = fixture(), life = new PluginLifecycleController([]);
  life.stage(() => { f.controller.register("test", declaration, () => {}); throw new Error("No disposable returned"); });
  expect(() => life.promote()).toThrow("No disposable returned"); expect(f.controller.inspect()).toEqual([]);
  life.stop();
  const old = f.controller.register("test", declaration, () => {}), next = new PluginLifecycleController([]);
  next.stage(() => f.controller.register("test", { ...declaration, label: "Replacement" }, () => {}));
  next.promote(); old.dispose(); expect(f.controller.list().schedules[0].label).toBe("Replacement");
  next.stop(); expect(f.controller.inspect()).toEqual([]);
});

test("pause persists, manual run bypasses pause once, and attempt/success stamps survive a new controller", async () => {
  const f = fixture(); let calls = 0;
  const off = f.controller.register("test", declaration, () => { calls++; });
  await f.controller.control(command("pause")); f.controller.sweep(); await Bun.sleep(0); expect(calls).toBe(0);
  const result = await f.controller.control(command("run"));
  expect(result).toMatchObject({ status: "completed", schedule: { paused: true, running: false, lastOutcome: "succeeded", lastSuccessAt: 1_000_000 } });
  expect(calls).toBe(1); off.dispose();
  const fresh = new PluginScheduleController(f.storage, () => {});
  const next = fresh.register("test", declaration, () => {});
  expect(fresh.list().schedules[0]).toMatchObject({ paused: true, lastOutcome: "succeeded" }); next.dispose();
});
test("failures are not successes, periodic retries wait a cadence and persistence failure prevents dispatch", async () => {
  const f = fixture(); let calls = 0;
  const off = f.controller.register("test", declaration, () => { calls++; throw new AppError("sync/network", "failed"); });
  await expect(f.controller.control(command("run"))).rejects.toMatchObject({ code: "sync/network" });
  expect(f.controller.list().schedules[0]).toMatchObject({ lastOutcome: "failed", lastSuccessAt: null, lastErrorCode: "sync/network" });
  f.controller.sweep(); await Bun.sleep(0); expect(calls).toBe(1);
  f.advance(); f.controller.sweep(); await Bun.sleep(0); expect(calls).toBe(2);
  f.fail(true); await expect(f.controller.control(command("pause"))).rejects.toMatchObject({ code: "db/locked" });
  expect(f.controller.list().schedules[0].paused).toBe(false);
  await expect(f.controller.control(command("run"))).rejects.toMatchObject({ code: "db/locked" }); expect(calls).toBe(2);
  off.dispose();
});
test("in-flight callbacks block replacements from overlapping, and retired pending starts never execute", async () => {
  const f = fixture(); let finish!: () => void, replacementCalls = 0;
  const first = f.controller.register("test", declaration, () => new Promise<void>(resolve => { finish = resolve; }));
  const running = f.controller.control(command("run")); await Bun.sleep(0);
  const replacement = f.controller.register("test", declaration, () => { replacementCalls++; }); first.dispose();
  expect((await f.controller.control(command("run"))).status).toBe("already-running");
  finish(); await expect(running).rejects.toMatchObject({ code: "plugin/cancelled" });
  expect(f.controller.list().schedules[0].lastOutcome).toBe("interrupted");
  await f.controller.control(command("run")); expect(replacementCalls).toBe(1);
  const late = f.controller.control(command("run")); replacement.dispose();
  await expect(late).rejects.toMatchObject({ code: "plugin/cancelled" }); expect(replacementCalls).toBe(1);
  expect(f.controller.inspect()).toEqual([]);
});
test("same-plugin writes do not lose another schedule, and observations are scoped and disposable", async () => {
  const f = fixture(), a = f.controller.register("test", declaration, () => {}), b = f.controller.register("test", { ...declaration, id: "other" }, () => {});
  const foreign = f.controller.register("foreign", declaration, () => {}), seen: number[] = [];
  const stop = f.controller.observe({ pluginId: "test", limit: 1 }, page => { seen.push(page.total); expect(page.schedules.every(item => item.pluginId === "test")).toBe(true); });
  await Promise.all([f.controller.control(command("pause")), f.controller.control({ pluginId: "test", id: "other", action: "pause" })]);
  expect(f.disk.get("test")?.refresh.paused).toBe(true); expect(f.disk.get("test")?.other.paused).toBe(true);
  expect(f.controller.list({ pluginId: "test", limit: 1 }).nextOffset).toBe(1);
  stop(); const count = seen.length; a.dispose(); b.dispose(); foreign.dispose(); await Bun.sleep(0); expect(seen).toHaveLength(count);
  expect(() => f.controller.list({ limit: 101 })).toThrow();
});

test("retirement drains an accepted persistence write before a plugin snapshot can proceed", async () => {
  const f = fixture(); let release!: () => void;
  const write = f.storage.write;
  f.storage.write = async (id, records) => { await new Promise<void>(resolve => { release = resolve; }); await write(id, records); };
  const binding = f.controller.register("test", declaration, () => {});
  const pause = f.controller.control(command("pause")); await Bun.sleep(0); binding.dispose();
  let drained = false;
  const drain = f.controller.drainWrites("test").then(() => { drained = true; });
  await Bun.sleep(0); expect(drained).toBe(false);
  release(); await expect(pause).rejects.toMatchObject({ code: "plugin/cancelled" }); await drain;
  expect(f.disk.get("test")?.refresh.paused).toBe(true); expect(f.controller.inspect()).toEqual([]);
});
