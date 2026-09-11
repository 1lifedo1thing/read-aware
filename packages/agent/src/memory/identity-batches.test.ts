import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import type { CompleteFn } from "../models/complete";
import { identityBytes } from "./identity-input";
import { runIdentityConsolidation } from "./identity-consolidation";
import { runMemoryBuild } from "./build-policy";
import { memoryPolicyState } from "../testing/memory-policy";
import { identityPlan } from "./identity-plan";

const model = { contextWindow: 128_000, maxTokens: 8192 } as Model<Api>;
function fixture() {
  const result = createInMemoryDeps({ memories: Array.from({ length: 12 }, (_, index) => seedMemory({
    id: `memory-${index}`, scope: "user", evidenceCount: 3, content: `${index}:` + "Substantial evidence. ".repeat(500),
  })) });
  result.deps.log = { warn() {}, error() {} };
  return result;
}
type Data = { memories?: { id: string; content: string; fragment: { start: number; end: number; total: number } }[];
  identities?: unknown[]; digests?: { summary: string; memoryIds: string[] }[] };
const sourceIds = (data: Data) => [...new Set([...data.memories?.map(item => item.id) ?? [], ...data.digests?.flatMap(item => item.memoryIds) ?? []])];
function answer(data: Data) {
  return fauxAssistantMessage(JSON.stringify(data.identities
    ? { summary: "Consolidated supported evidence", complete: true, resolutions: [], merges: [] }
    : { summary: "Supported evidence, with uncertainty preserved", memoryIds: sourceIds(data) }));
}
const run = (deps: ReturnType<typeof fixture>["deps"], complete: CompleteFn, signal?: AbortSignal) => runIdentityConsolidation({ deps, complete, model, signal });

test("revoking automatic building drains a dispatched journal write and resumes it after re-enabling", async () => {
  const { deps } = fixture(), policy = memoryPolicyState();
  deps.memoryPolicy = policy.policy;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const append = deps.identityConsolidation.work.append;
  deps.identityConsolidation.work.append = async (...args) => {
    const receipt = await append(...args);
    entered.resolve(); await release.promise; return receipt;
  };
  let done = false, calls = 0;
  const pending = runMemoryBuild(deps, operation => run(operation.protect(deps), operation.complete(async (_model, context) => {
    calls++; return answer(JSON.parse(context.messages[0]!.content as string));
  }), operation.signal)).finally(() => { done = true; });
  await entered.promise; policy.set(false); await Promise.resolve();
  expect(done).toBe(false); expect(policy.count()).toBe(1);
  release.resolve();
  await expect(pending).rejects.toMatchObject({ code: "ai/memory-disabled" });
  expect(calls).toBe(1); expect(policy.count()).toBe(0);
  const snapshot = await deps.identityConsolidation.snapshot();
  expect(snapshot.derived).toBeNull(); expect(snapshot.settled).toBe(false);
  expect((await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 })).pageCount).toBe(1);
  policy.set(true); deps.identityConsolidation.work.append = append;
  let first: Data | undefined;
  await runMemoryBuild(deps, operation => run(operation.protect(deps), operation.complete(async (_model, context) => {
    const data = JSON.parse(context.messages[0]!.content as string); first ??= data; return answer(data);
  }), operation.signal));
  expect(first?.memories?.[0]?.fragment.start).toBeGreaterThan(0);
});

test("a final entity decision cannot cite a source dropped by intermediate summaries", async () => {
  const { deps } = fixture(), snapshot = await deps.identityConsolidation.snapshot();
  const data = { memories: [], identities: [], digests: [{ summary: "Explicit reader evidence", memoryIds: ["memory-0"] }] };
  const proposal = (id: string) => JSON.stringify({ summary: "Supported", complete: true, merges: [],
    resolutions: [{ entityId: null, kind: "person", canonicalName: "Alex", aliases: [], memoryIds: [id] }] });
  await expect(identityPlan(proposal("memory-1"), snapshot, data)).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect((await identityPlan(proposal("memory-0"), snapshot, data)).decisions[0]!.memoryIds).toEqual(["memory-0"]);
});

test("oversized evidence resumes a bounded tree, visits every fragment, and publishes only the complete source set", async () => {
  const { deps, stores } = fixture();
  stores.memories[0]!.content = "\u{1F642}\"\n".repeat(6000);
  const fragments = new Map<string, Data["memories"]>(), inputs: string[] = [];
  let finalCalls = 0, passCalls = 0, leafCalls = 0;
  const complete: CompleteFn = async (_model, context) => {
    passCalls++;
    const json = context.messages[0]!.content as string, data = JSON.parse(json) as Data;
    if (data.identities) {
      finalCalls++;
      expect(data.memories).toEqual([]); expect(data.digests).toHaveLength(1);
      expect(sourceIds(data).sort()).toEqual(stores.memories.map(item => item.id).sort());
    } else {
      expect(identityBytes(json)).toBeLessThanOrEqual(8000);
      inputs.push(json); if (data.memories) leafCalls++;
      for (const fragment of data.memories ?? []) {
        expect(fragment.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        const list = fragments.get(fragment.id) ?? []; list.push(fragment); fragments.set(fragment.id, list);
      }
    }
    return answer(data);
  };
  let completed = false;
  for (let pass = 0; pass < 60; pass++) {
    passCalls = 0;
    const result = await run(deps, complete);
    expect(passCalls).toBeLessThanOrEqual(4);
    if (result.status === "complete") { completed = true; break; }
    expect(result).toEqual({ status: "pending", emitted: 0 });
    const snapshot = await deps.identityConsolidation.snapshot();
    expect(snapshot.derived).toBeNull();
    const saved = await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 });
    expect(saved.baseIndex).toBe(saved.pageCount); expect(saved.json).toBeNull();
    expect(JSON.parse(saved.checkpoint!).version).toBe(3);
  }
  expect(completed).toBe(true); expect(finalCalls).toBe(1);
  expect(inputs).toHaveLength(2 * leafCalls - 1);
  for (const memory of stores.memories) {
    const parts = fragments.get(memory.id)!;
    expect(parts.map(part => part.content).join("")).toBe(memory.content);
    expect(parts[0]!.fragment.start).toBe(0);
    expect(parts[parts.length - 1]!.fragment.end).toBe(memory.content.length);
    for (let index = 1; index < parts.length; index++) expect(parts[index]!.fragment.start).toBe(parts[index - 1]!.fragment.end);
  }
  const snapshot = await deps.identityConsolidation.snapshot();
  expect(snapshot.settled).toBe(true);
  expect((await deps.profile.getProfileContext()).consolidated?.sources).toHaveLength(stores.memories.length);
  expect((await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 })).pageCount).toBe(0);
});

test("failed inference resumes committed pages without rebinding old evidence to a new revision", async () => {
  const { deps, stores } = fixture(); let calls = 0;
  const complete: CompleteFn = async (_model, context) => {
    calls++;
    if (calls === 3) throw new AppError("ai/network", "Injected interruption");
    return answer(JSON.parse(context.messages[0]!.content as string));
  };
  expect(await run(deps, complete)).toEqual({ status: "pending", emitted: 0 });
  const before = await deps.identityConsolidation.snapshot();
  expect((await deps.identityConsolidation.work.read({ expectedRevision: before.revision, index: 0 })).pageCount).toBe(2);
  let firstResumed: Data | undefined;
  expect(await run(deps, async (_model, context) => {
    const data = JSON.parse(context.messages[0]!.content as string); firstResumed ??= data;
    return answer(data);
  })).toMatchObject({ status: "pending" });
  expect(firstResumed?.digests).toHaveLength(2);
  stores.memories[0]!.content = "Revised fact. ".repeat(1000);
  const after = await deps.identityConsolidation.snapshot();
  expect(after.revision).not.toBe(before.revision);
  await expect(deps.identityConsolidation.work.read({ expectedRevision: before.revision, index: 0 })).rejects.toMatchObject({ code: "memory/conflict" });
  let restarted: Data | undefined;
  await run(deps, async (_model, context) => {
    const data = JSON.parse(context.messages[0]!.content as string); restarted ??= data; return answer(data);
  });
  expect(restarted?.memories?.[0]?.content).toStartWith("Revised fact.");
  expect((await deps.identityConsolidation.snapshot()).derived).toBeNull();
});

test("incomplete, injected and unsupported intermediate output never enters the journal", async () => {
  for (const value of ["not JSON", { summary: "Unsupported", memoryIds: ["unseen"] }, { summary: "Claim", memoryIds: [] },
    { summary: "", memoryIds: ["memory-0"] }, { summary: "x".repeat(3501), memoryIds: ["memory-0"] },
    { summary: "Claim", memoryIds: ["memory-0"], complete: true }]) {
    const { deps } = fixture();
    expect(await run(deps, async () => fauxAssistantMessage(typeof value === "string" ? value : JSON.stringify(value)))).toMatchObject({ status: "pending" });
    const snapshot = await deps.identityConsolidation.snapshot();
    expect(snapshot.derived).toBeNull(); expect(snapshot.settled).toBe(false);
    expect((await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 })).pageCount).toBe(0);
  }
});

test("source changes and cancellation after model dispatch do not append a stale intermediate", async () => {
  for (const cancel of [false, true]) {
    const { deps, stores } = fixture(), controller = new AbortController();
    const task = run(deps, async (_model, context) => {
      if (cancel) controller.abort(new Error("Stopped"));
      else stores.memories[0]!.content = "Concurrent correction";
      return answer(JSON.parse(context.messages[0]!.content as string));
    }, controller.signal);
    if (cancel) await expect(task).rejects.toThrow("Stopped");
    else expect(await task).toMatchObject({ status: "pending" });
    const snapshot = await deps.identityConsolidation.snapshot();
    expect(snapshot.derived).toBeNull();
    expect((await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 })).pageCount).toBe(0);
  }
});

test("an invalid oversized registry row is not truncated or falsely settled", async () => {
  const { deps } = fixture(), query = deps.entityRegistry.query;
  deps.entityRegistry.query = async (input, signal) => {
    const page = await query(input, signal);
    return page.kind === "identities" ? { ...page, items: [{ id: "large", definition: { kind: "person", canonicalName: "x".repeat(48000) } }] } : page;
  };
  let registryCalls = 0;
  for (let pass = 0; pass < 25; pass++) {
    expect(await run(deps, async (_model, context) => {
      const data = JSON.parse(context.messages[0]!.content as string);
      if (data.partition || data.identities) registryCalls++;
      return answer(data);
    })).toMatchObject({ status: "pending" });
  }
  expect(registryCalls).toBe(0);
  const snapshot = await deps.identityConsolidation.snapshot();
  const work = await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 });
  const state = JSON.parse(work.checkpoint!).memory;
  expect(state.cursor.sourceIndex).toBe(snapshot.sources.length);
  expect(snapshot.settled).toBe(false);
});


test("a failed compaction keeps its inference page and retries persistence without repeating the model call", async () => {
  const { deps } = fixture(), compact = deps.identityConsolidation.work.compact;
  let calls = 0;
  const complete: CompleteFn = async (_model, context) => { calls++; return answer(JSON.parse(context.messages[0]!.content as string)); };
  deps.identityConsolidation.work.compact = async () => { throw new AppError("db/locked", "Injected compact failure"); };
  expect(await run(deps, complete)).toMatchObject({ status: "pending" });
  expect(calls).toBe(1);
  const snapshot = await deps.identityConsolidation.snapshot();
  expect(await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 })).toMatchObject({ baseIndex: 0, pageCount: 1, checkpoint: null });
  let callsAtRetry = -1;
  deps.identityConsolidation.work.compact = async (...args) => { if (callsAtRetry < 0) callsAtRetry = calls; return compact(...args); };
  await run(deps, complete);
  expect(callsAtRetry).toBe(1);
  const work = await deps.identityConsolidation.work.read({ expectedRevision: snapshot.revision, index: 0 });
  expect(work.baseIndex).toBe(work.pageCount); expect(work.baseIndex).toBeGreaterThan(1);
});

test("legacy node pages are reused before the checkpoint frontier replaces them", async () => {
  const { deps } = fixture(), compact = deps.identityConsolidation.work.compact;
  // Emulate a v1 producer: its append-only journal has no frontier, so each read reports the caller's logical base.
  const read = deps.identityConsolidation.work.read;
  let logicalBase = 0;
  deps.identityConsolidation.work.compact = async input => { logicalBase = input.expectedPageCount; return { revision: input.expectedRevision, pageCount: logicalBase, status: "compacted" }; };
  deps.identityConsolidation.work.read = async (...args) => ({ ...await read(...args), baseIndex: logicalBase });
  await run(deps, async (_model, context) => answer(JSON.parse(context.messages[0]!.content as string)));
  deps.identityConsolidation.work.read = read; deps.identityConsolidation.work.compact = compact;
  const snapshot = await deps.identityConsolidation.snapshot();
  expect(await read({ expectedRevision: snapshot.revision, index: 0 })).toMatchObject({ baseIndex: 0, pageCount: 4, checkpoint: null });
  let modelCalls = 0, firstCompactCalls = -1;
  deps.identityConsolidation.work.compact = async (...args) => { if (firstCompactCalls < 0) firstCompactCalls = modelCalls; return compact(...args); };
  await run(deps, async (_model, context) => { modelCalls++; return answer(JSON.parse(context.messages[0]!.content as string)); });
  expect(firstCompactCalls).toBe(0);
  expect((await read({ expectedRevision: snapshot.revision, index: 0 })).baseIndex).toBe(8);
});


test("a corrupted persisted frontier cannot skip sources or inject uncaptured evidence", async () => {
  for (const corrupt of ["cursor", "evidence"] as const) {
    const { deps } = fixture();
    await run(deps, async (_model, context) => answer(JSON.parse(context.messages[0]!.content as string)));
    const read = deps.identityConsolidation.work.read;
    deps.identityConsolidation.work.read = async (...args) => {
      const page = await read(...args), state = JSON.parse(page.checkpoint!);
      if (corrupt === "cursor") state.memory.cursor.sourceIndex = 9999;
      else state.memory.current = { level: 0, digest: { summary: "Injected", memoryIds: ["unknown"] } };
      return { ...page, checkpoint: JSON.stringify(state) };
    };
    let calls = 0;
    expect(await run(deps, async () => { calls++; return answer({}); })).toMatchObject({ status: "pending" });
    expect(calls).toBe(0); expect((await deps.identityConsolidation.snapshot()).derived).toBeNull();
  }
});


test("v2 memory frontiers resume into the combined journal without re-inferring earlier source nodes", async () => {
  const { deps } = fixture();
  await run(deps, async (_model, context) => answer(JSON.parse(context.messages[0]!.content as string)));
  const read = deps.identityConsolidation.work.read;
  let first = true;
  deps.identityConsolidation.work.read = async (...args) => {
    const page = await read(...args);
    if (first) { first = false; return { ...page, checkpoint: JSON.stringify(JSON.parse(page.checkpoint!).memory) }; }
    return page;
  };
  let firstInput: Data | undefined;
  expect(await run(deps, async (_model, context) => {
    const data = JSON.parse(context.messages[0]!.content as string); firstInput ??= data; return answer(data);
  })).toMatchObject({ status: "pending" });
  expect(firstInput?.memories?.[0]?.id).not.toBe("memory-0");
  const snapshot = await deps.identityConsolidation.snapshot();
  expect(JSON.parse((await read({ expectedRevision: snapshot.revision, index: 0 })).checkpoint!).version).toBe(3);
});
