import { expect, test } from "bun:test";
import { SyncWorkGate } from "./sync-work-gate";

test("reservation drains admitted physical work, defers new producers and allows only its own fetches", async () => {
  const gate = new SyncWorkGate(), first = Promise.withResolvers<void>(), backup = Promise.withResolvers<void>();
  const order: string[] = [];
  const accepted = gate.run(async () => { order.push("accepted"); await first.promise; order.push("settled"); });
  const paused = gate.withPaused(async run => {
    order.push("backup");
    expect(await run(async () => "owned")).toBe("owned");
    await backup.promise; order.push("release");
  });
  const later = gate.run(async () => { order.push("later"); });
  await Bun.sleep(0); expect(order).toEqual(["accepted"]);
  await expect(gate.withPaused(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
  first.resolve(); await accepted; await Bun.sleep(0);
  expect(order).toEqual(["accepted", "settled", "backup"]);
  backup.resolve(); await paused; await later;
  expect(order).toEqual(["accepted", "settled", "backup", "release", "later"]);
});

test("a failed cycle retains its caller's error without preventing an offline local backup", async () => {
  const gate = new SyncWorkGate(), failure = new Error("network"), work = Promise.withResolvers<void>();
  const failed = gate.run(async () => { await work.promise; throw failure; }).catch(error => error);
  const pause = gate.withPaused(async () => 17);
  work.resolve(); expect(await failed).toBe(failure); expect(await pause).toBe(17);
});

test("cancelled drain and failed backup retain their active work and reject escaped fetch permissions", async () => {
  const gate = new SyncWorkGate(), prior = Promise.withResolvers<void>(), controller = new AbortController();
  const active = gate.run(() => prior.promise);
  let entered = false, completed = false;
  const cancelled = gate.withPaused(async () => { entered = true; }, controller.signal)
    .catch(error => { completed = true; return error; });
  controller.abort(new Error("cancelled"));
  await Bun.sleep(0); expect(completed).toBe(false);
  prior.resolve(); await active; expect((await cancelled).message).toBe("cancelled"); expect(entered).toBe(false);
  const owned = Promise.withResolvers<void>();
  let escaped: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
  const failed = gate.withPaused(async run => {
    escaped = run;
    void run(() => owned.promise);
    throw new Error("backup failed");
  }).catch(error => error);
  let resumed = false;
  const later = gate.run(async () => { resumed = true; });
  await Bun.sleep(0); expect(resumed).toBe(false);
  await expect(escaped!(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
  owned.resolve(); expect((await failed).message).toBe("backup failed"); await later;
  expect(resumed).toBe(true);
});
