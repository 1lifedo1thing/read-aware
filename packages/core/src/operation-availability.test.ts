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
