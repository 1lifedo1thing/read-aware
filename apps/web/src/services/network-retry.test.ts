import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { NetworkRetry, networkRetryDelay, waitForNetworkRetry } from "./network-retry";

test("safe retries release failed responses before waiting and share allowance across redirect hops", async () => {
  const trace: unknown[] = [];
  const retry = new NetworkRetry(new AbortController().signal, reason => trace.push(reason), async ms => { trace.push(ms); });
  let calls = 0;
  const response = await retry.run(async () => {
    calls++;
    return calls < 3 ? new Response(new ReadableStream({ cancel() { trace.push("cancel"); } }), { status: 503 }) : new Response("ok");
  }, true);
  expect(await response.text()).toBe("ok"); expect(calls).toBe(3);
  expect(trace[0]).toBe("cancel"); expect(trace[2]).toBe(500); expect(trace[5]).toBe(1000);
  expect((await retry.run(async () => { calls++; return new Response(null, { status: 502 }); }, true)).status).toBe(502);
  expect(calls).toBe(4);
});
test("unsafe operations, structured errors and long server cooldowns are not retried", async () => {
  const retry = new NetworkRetry(new AbortController().signal, () => { throw Error("Unexpected retry"); });
  expect((await retry.run(async () => new Response(null, { status: 503 }), false)).status).toBe(503);
  await expect(retry.run(async () => { throw new AppError("plugin/network-denied", "Denied"); }, true)).rejects.toMatchObject({ code: "plugin/network-denied" });
  expect((await retry.run(async () => new Response(null, { status: 429, headers: { "retry-after": "31" } }), true)).status).toBe(429);
  expect(networkRetryDelay("bad", 1)).toBe(1000);
  expect(networkRetryDelay("2", 0)).toBe(2000);
  expect(networkRetryDelay("Thu, 01 Jan 1970 00:00:05 GMT", 0, 1000)).toBe(4000);
});
test("transport rejection retries before headers, cancellation aborts backoff and no next request is dispatched", async () => {
  const controller = new AbortController(); let calls = 0;
  const retry = new NetworkRetry(controller.signal, () => {}, async (_ms, signal) => { controller.abort(new AppError("plugin/cancelled", "Stopped")); await waitForNetworkRetry(1000, signal); });
  await expect(retry.run(async () => { calls++; throw new TypeError("Native failure"); }, true)).rejects.toMatchObject({ code: "plugin/cancelled" });
  expect(calls).toBe(1);
  const pendingController = new AbortController();
  const wait = waitForNetworkRetry(30_000, pendingController.signal);
  pendingController.abort(new Error("Stopped")); await expect(wait).rejects.toThrow("Stopped");
});
