import { expect, test } from "bun:test";
import { assertOperationAvailable, normalizeOperationAvailability, operationAvailability } from "./operation-availability";

test("availability rejects arbitrary operations and distinguishes missing prerequisites from unknown remote health", () => {
  for (const input of [null, [], {}, { operation: "sql" }, { operation: "llm.infer", model: "secret" },
    { operation: "llm.infer", images: 1 }, { operation: "llm.infer", endpoint: "private" }]) expect(() => normalizeOperationAvailability(input)).toThrow();
  const query = normalizeOperationAvailability({ operation: "llm.infer" });
  expect(query).toEqual({ operation: "llm.infer", model: "fast", images: false });
  const unknown = operationAvailability(query, [{ kind: "provider", state: "unknown", reason: "remote-health-not-checked" }]);
  expect(unknown.state).toBe("unknown"); expect(() => assertOperationAvailable(unknown)).not.toThrow();
  const missing = operationAvailability(query, [...unknown.conditions, { kind: "account", state: "unconfigured", reason: "credential-missing", errorCode: "ai/not-configured" }]);
  expect(missing.state).toBe("unconfigured"); expect(() => assertOperationAvailable(missing)).toThrow(expect.objectContaining({ code: "ai/not-configured" }));
});

test("reading availability requires an explicit bounded target and the exact operation's fields", () => {
  const query = { operation: "reading.playback", bookId: "book", sessionId: "session", action: "stop" };
  expect(normalizeOperationAvailability(query)).toEqual(query);
  const mode = { operation: "reading.mode.configure", bookId: "book", active: true, selectModeKey: "mode", unitId: "sentence" };
  expect(normalizeOperationAvailability(mode)).toEqual(mode);
  for (const input of [{ ...query, bookId: undefined }, { ...query, action: "pause" }, { ...query, model: "fast" },
    { ...query, bookId: " " }, { ...query, sessionId: "x".repeat(513) }, { ...mode, active: undefined },
    { ...mode, images: false }, { ...mode, modeKey: 3 }]) expect(() => normalizeOperationAvailability(input)).toThrow();
  expect(operationAvailability(normalizeOperationAvailability(query), [])).not.toHaveProperty("model");
});

test("text preparation discovery uses actual admission defaults and rejects malformed options", () => {
  const input = { operation: "library.text.prepare", bookId: "book" };
  expect(normalizeOperationAvailability(input)).toEqual({ ...input, rebuild: false, priority: "normal", timeoutMs: 1800000 });
  for (const patch of [{ bookId: "" }, { bookId: "x".repeat(257) }, { sessionId: "session" }, { priority: "urgent" },
    { rebuild: 1 }, { timeoutMs: null }, { timeoutMs: 999 }, { timeoutMs: 7200001 }, { timeoutMs: 1000.5 }]) {
    expect(() => normalizeOperationAvailability({ ...input, ...patch })).toThrow();
  }
  const blocked = operationAvailability(normalizeOperationAvailability(input), [{ kind: "capacity", state: "unavailable", reason: "text-task-limit", errorCode: "library/text-task-limit" }]);
  expect(() => assertOperationAvailable(blocked)).toThrow(expect.objectContaining({ code: "library/text-task-limit" }));
});
