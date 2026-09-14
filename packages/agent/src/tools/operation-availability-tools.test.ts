import { expect, test } from "bun:test";
import { normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildOperationAvailabilityTools } from "./operation-availability-tools";
import { buildAgentTools } from "./registry";

test("both Agent scopes expose live operation prerequisites and retire cancelled queries", async () => {
  const { deps } = createInMemoryDeps();
  const calls: unknown[] = [];
  deps.operationAvailability = { check: async query => { calls.push(query); return operationAvailability(normalizeOperationAvailability(query), [{ kind: "provider", state: "unknown", reason: "remote-health-not-checked" }]); } };
  for (const scope of [{ kind: "book" as const, bookId: "b" }, { kind: "global" as const, threadId: "g" }]) {
    const tool = buildAgentTools(scope, deps).find(tool => tool.name === "get_operation_availability")!;
    const result = await tool.execute("query", { operation: "llm.infer", model: "smart", images: true });
    expect(JSON.stringify(result.content)).toContain("remote-health-not-checked");
  }
  expect(calls).toHaveLength(2);
  const abort = new AbortController(), wait = Promise.withResolvers<void>();
  const prior = deps.operationAvailability.check;
  deps.operationAvailability.check = async query => { await wait.promise; return prior(query); };
  const pending = buildOperationAvailabilityTools(deps)[0]!.execute("late", { operation: "llm.infer" }, abort.signal);
  abort.abort(new Error("retired")); wait.resolve(); await expect(pending).rejects.toThrow("retired");
  delete deps.operationAvailability;
  expect(JSON.stringify((await buildOperationAvailabilityTools(deps)[0]!.execute("unknown", { operation: "llm.infer" })).content)).toContain("host-prerequisites-unavailable");
});
