import { expect, test } from "bun:test";
import { DomainWriteGate, type RunDomainWrite } from "./domain-write-gate";
import { WriteSettlement } from "./write-settlement";

test("draining includes dependent writes, then atomically rejects fresh transactions", async () => {
  const settlement = new WriteSettlement(), gate = new DomainWriteGate(settlement);
  const first = Promise.withResolvers<void>(), next = Promise.withResolvers<void>();
  let entered = false, followup: Promise<void> | undefined;
  const write = gate.run(async () => { await first.promise; followup = gate.run(() => next.promise); });
  const backup = gate.withPaused(async () => {
    entered = true;
    await expect(gate.run(() => { throw new Error("must not dispatch"); })).rejects.toMatchObject({ code: "backup/busy" });
  });
  first.resolve(); await write; await Bun.sleep(0);
  expect(entered).toBe(false); expect(settlement.size).toBe(1);
  next.resolve(); await followup; await backup;
  expect(entered).toBe(true); expect(await gate.run(() => 7)).toBe(7);
});

test("cancelled drain waits for physical failure, and another backup cannot acquire it", async () => {
  const gate = new DomainWriteGate(), pending = Promise.withResolvers<void>(), controller = new AbortController();
  const write = gate.run(() => pending.promise).catch(error => error);
  let finished = false, called = false;
  const backup = gate.withPaused(async () => { called = true; }, controller.signal).catch(error => { finished = true; return error; });
  controller.abort(new Error("cancelled")); await Bun.sleep(0);
  expect(finished).toBe(false);
  await expect(gate.withPaused(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
  pending.reject(new Error("native failure"));
  expect(await write).toMatchObject({ message: "native failure" });
  expect(await backup).toMatchObject({ message: "cancelled" }); expect(called).toBe(false);
  expect(await gate.withPaused(async () => "reusable")).toBe("reusable");
});

test("owned work drains after scope failure and its grant cannot escape or reopen normal writes", async () => {
  const gate = new DomainWriteGate(), physical = Promise.withResolvers<void>();
  let escaped!: RunDomainWrite, settled = false;
  const backup = gate.withPaused(async run => {
    escaped = run; void run(() => physical.promise);
    await expect(gate.run(() => 1)).rejects.toMatchObject({ code: "backup/busy" });
    throw new Error("capture failed");
  }).catch(error => { settled = true; return error; });
  await Bun.sleep(0); expect(settled).toBe(false);
  await expect(escaped(() => 2)).rejects.toMatchObject({ code: "backup/busy" });
  await expect(gate.run(() => 3)).rejects.toMatchObject({ code: "backup/busy" });
  physical.resolve(); expect(await backup).toMatchObject({ message: "capture failed" });
  await expect(escaped(() => 4)).rejects.toMatchObject({ code: "backup/busy" });
  expect(await gate.run(() => 5)).toBe(5);
});
