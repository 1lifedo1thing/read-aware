import { expect, test } from "bun:test";
import { normalizeDeferredRequest } from "./plugin-schedules";

test("deferred requests are bounded, explicit and copied before asynchronous admission", () => {
  const input = { requestId: "task-1", delayMs: 1000, when: "idle" as const };
  expect(normalizeDeferredRequest(input)).toEqual(input); expect(normalizeDeferredRequest(input)).not.toBe(input);
  for (const patch of [{ delayMs: 999 }, { delayMs: 604_800_001 }, { delayMs: NaN }, { delayMs: 1000.1 }, { when: "quiet" },
    { requestId: "" }, { requestId: "x".repeat(65) }, { requestId: "../task" }, { origin: "user" }, { code: "arbitrary" }]) {
    expect(() => normalizeDeferredRequest({ ...input, ...patch } as never)).toThrow();
  }
});
