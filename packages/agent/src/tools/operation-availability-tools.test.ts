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
  const pending = buildOperationAvailabilityTools(deps, { kind: "book", bookId: "b" })[0]!.execute("late", { operation: "llm.infer" }, abort.signal);
  abort.abort(new Error("retired")); wait.resolve(); await expect(pending).rejects.toThrow("retired");
  delete deps.operationAvailability;
  expect(JSON.stringify((await buildOperationAvailabilityTools(deps, { kind: "book", bookId: "b" })[0]!.execute("unknown", { operation: "llm.infer" })).content)).toContain("host-prerequisites-unavailable");
});

test("Agent reading condition queries keep book scope and forward exact action/session inputs", async () => {
  const { deps } = createInMemoryDeps();
  const calls: unknown[] = [];
  deps.operationAvailability = { check: async input => {
    calls.push(input); return operationAvailability(normalizeOperationAvailability(input), [{ kind: "provider", state: "unknown", reason: "audio-output-not-checked" }]);
  } };
  const query = { operation: "reading.playback", bookId: "book", sessionId: "session", action: "start" };
  const tool = buildOperationAvailabilityTools(deps, { kind: "book", bookId: "book" })[0]!;
  expect(JSON.stringify((await tool.execute("query", { ...query, bookId: "foreign" })).content)).toContain("book-scope-required");
  expect(calls).toHaveLength(0);
  await tool.execute("query", query); expect(calls).toEqual([query]);
  const mode = { operation: "reading.mode.configure", bookId: "other", active: true, selectModeKey: "mode", unitId: "sentence" };
  await buildOperationAvailabilityTools(deps, { kind: "global", threadId: "global" })[0]!.execute("mode", mode);
  expect(calls[1]).toEqual(mode);
  await expect(tool.execute("invalid", { ...query, model: "fast" })).rejects.toMatchObject({ code: "plugin/invalid-argument" });
});
