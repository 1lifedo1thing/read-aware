import { expect, test } from "bun:test";
import { WriteSettlement } from "./write-settlement";

test("settlement waits for every dispatched write, including ones dispatched meanwhile, without changing outcomes", async () => {
  const writes = new WriteSettlement(), first = Promise.withResolvers<number>(), second = Promise.withResolvers<void>();
  const tracked = writes.track(first.promise);
  expect(writes.size).toBe(1);
  let settled = false;
  const settling = writes.settle().then(() => { settled = true; });
  await Bun.sleep(0); expect(settled).toBe(false);
  writes.track(second.promise);
  first.resolve(7); await Bun.sleep(0); expect(settled).toBe(false);
  second.reject(new Error("write failed")); await settling;
  expect(settled).toBe(true); expect(await tracked).toBe(7); expect(writes.size).toBe(0);
  const failing = writes.track(Promise.reject(new Error("still rejects")));
  await expect(failing).rejects.toMatchObject({ message: "still rejects" });
  await writes.settle();
  const controller = new AbortController(); controller.abort(new Error("caller gone"));
  writes.track(new Promise(() => {}));
  await expect(writes.settle(controller.signal)).rejects.toMatchObject({ message: "caller gone" });
});

test("accepted preparation and observer follow-up stay pending; aborting a waiter preserves physical work", async () => {
  const writes = new WriteSettlement(), prepare = Promise.withResolvers<void>(), followup = Promise.withResolvers<void>();
  const controller = new AbortController();
  let started = false;
  const operation = writes.run(async () => {
    started = true;
    await prepare.promise;
    writes.run(() => followup.promise);
    return 9;
  });
  expect(started).toBe(false); expect(writes.size).toBe(1);
  const aborted = writes.settle(controller.signal).catch(error => error);
  await Bun.sleep(0); controller.abort(new Error("stop waiting"));
  expect((await aborted).message).toBe("stop waiting");
  expect(writes.size).toBe(1);
  let finished = false;
  const drain = writes.settle().then(() => { finished = true; });
  prepare.resolve(); expect(await operation).toBe(9);
  await Bun.sleep(0); expect(finished).toBe(false);
  followup.resolve(); await drain; expect(writes.size).toBe(0);
  await expect(writes.settle(controller.signal)).rejects.toMatchObject({ message: "stop waiting" });
});
