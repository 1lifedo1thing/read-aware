import { expect, test } from "bun:test";
import { createRequestCache } from "./request-cache";
const options = { ttlMs: 100, maxBytes: 6, maxEntries: 2, sizeOf: (value: string) => value.length };
test("deduplicated callers can cancel independently; all cancelled aborts the transfer", async () => {
  const cache = createRequestCache<string>(options);
  let calls = 0, shared!: AbortSignal, finish!: (value: string) => void;
  const loader = (signal: AbortSignal) => { calls++; shared = signal; return new Promise<string>(resolve => { finish = resolve; }); };
  const controller = new AbortController();
  const first = cache.get("a", loader, controller.signal); const second = cache.get("a", loader);
  await Promise.resolve(); controller.abort(); await expect(first).rejects.toBeDefined();
  expect(shared.aborted).toBe(false); finish("ok"); expect(await second).toBe("ok"); expect(calls).toBe(1);
  const last = new AbortController(); const cancelled = cache.get("b", loader, last.signal);
  await Promise.resolve(); last.abort(); await expect(cancelled).rejects.toBeDefined(); expect(shared.aborted).toBe(true); finish("late");
  expect(await cache.get("b", async () => "fresh")).toBe("fresh");
});
test("TTL, byte budget and invalidation bound reuse; failures are not cached", async () => {
  let now = 0, calls = 0;
  const cache = createRequestCache<string>({ ...options, now: () => now });
  const get = (key: string) => cache.get(key, async () => { calls++; return "123"; });
  await get("a"); await get("a"); expect(calls).toBe(1);
  await get("b"); await get("c"); await get("a"); expect(calls).toBe(4);
  now = 101; await get("a"); expect(calls).toBe(5);
  cache.invalidate("a"); await get("a"); expect(calls).toBe(6);
  await expect(cache.get("error", async () => { throw new Error("temporary"); })).rejects.toThrow();
  expect(await cache.get("error", async () => "ok")).toBe("ok");
});
