import { buildPluginContext } from "./plugin-context";
import * as jobStore from "../../../platform/durable-jobs";
import { expect, test, spyOn } from "bun:test";
import { BookGraphTaskOwner } from "@read-aware/agent";
import { createContextBundle, type MemoryRecord, type MemorySnapshot, type MemoryObservation, type ContextBundleKind } from "@read-aware/core";
import type { PluginBookAccess } from "@read-aware/plugin-types";
import { createMemoryDomain } from "../../../domain/memory";
import * as taskModule from "../../../domain/book-graph-tasks";
import { createPluginBookAccessPolicy, type CurrentBookSnapshot } from "../../../domain/plugin-object-access";
import type { ResourceAccess } from "../../../services/resource-access";
import type { ResourceOwner } from "../../../services/resource-owner";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { scopePluginMemory } from "./plugin-scoped-memory";
import { deferred } from "../../../../tests/helpers/entity-host";

const revision = `mem1:${"a".repeat(64)}`;
const row = (scope: MemoryRecord["scope"] = "book:a"): MemoryRecord => ({
  id: "m", scope, kind: "fact", content: "book fact", importance: 1, evidenceCount: 1, createdAt: "t", updatedAt: "t",
});
function fixture(grant: PluginBookAccess = { mode: "current" }, llm = true) {
  let current: CurrentBookSnapshot = { bookId: "a", sessionId: "a1" };
  const listeners = new Set<(value: CurrentBookSnapshot) => unknown>();
  const policy = createPluginBookAccessPolicy(grant, async () => current, handler => {
    listeners.add(handler); return () => { listeners.delete(handler); };
  }, () => current);
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const raw = createMemoryDomain("plugin:scoped-memory", lifecycle.signal, work => lifecycle.trackCleanup(work));
  const api = scopePluginMemory(raw, policy, lifecycle, {} as ResourceOwner, llm);
  return { raw, api, lifecycle, listeners, switchBook: (bookId: string | null, sessionId = `${bookId}1`) => {
    current = { bookId, sessionId }; for (const handler of [...listeners]) handler(current);
  }, close: async () => { lifecycle.stop(); await lifecycle.drainCleanups(); } };
}

test("fixed-book memory queries work without that book open, freeze input, and refuse global or mixed scopes", async () => {
  const f = fixture({ mode: "book", bookId: "a" }); f.switchBook("b");
  let readScopes: unknown, calls = 0;
  f.raw.queries.page = async query => { readScopes = query.scopes; calls++; return { items: [row()], total: 1, offset: 0, nextOffset: null, revision: "page" }; };
  f.raw.queries.inspect = async () => ({ memory: row("book:b"), revision });
  try {
    const query = { scopes: ["book:a" as const] }; const work = f.api.queries.page(query); query.scopes[0] = "book:b" as "book:a";
    expect((await work).items[0]?.scope).toBe("book:a"); expect(readScopes).toEqual(["book:a"]);
    for (const scopes of [["user"], ["global"], ["book:b"], ["book:a", "book:b"]] as MemoryRecord["scope"][][]) {
      expect(() => f.api.queries.page({ scopes })).toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
    }
    expect(calls).toBe(1);
    await expect(f.api.queries.inspect("m")).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect(() => f.api.queries.profile()).toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
    f.raw.queries.page = async () => ({ items: [row("user")], total: 1, offset: 0, nextOffset: null, revision: "page" });
    await expect(f.api.queries.page({ scopes: ["book:a"] })).rejects.toMatchObject({ code: "plugin/object-access-denied" });
  } finally { await f.close(); }
});

test("a current-book query rejects promptly after a switch and drains its actual read", async () => {
  const f = fixture(), entered = deferred(), gate = deferred();
  f.raw.queries.search = async () => { entered.resolve(); await gate.promise; return [row()]; };
  try {
    const pending = f.api.queries.search({ scopes: ["book:a"] });
    await entered.promise; f.switchBook("b");
    await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect(f.listeners.size).toBe(0);
    gate.resolve(); await f.lifecycle.drainCleanups();
  } finally { gate.resolve(); await f.close(); }
});

test("conditional mutations authorize the inspected immutable scope and preserve CAS and pre-dispatch cancellation", async () => {
  const f = fixture(); let snapshot: MemorySnapshot = { memory: row(), revision }, writes = 0;
  f.raw.queries.inspect = async () => snapshot;
  f.raw.commands.mutate = async (input, signal) => { signal?.throwIfAborted(); writes++; return { memoryId: input.memoryId, revision: null }; };
  const change = { op: "forget" as const, memoryId: "m", expectedRevision: revision };
  try {
    expect((await f.api.commands!.mutate(change)).memoryId).toBe("m"); expect(writes).toBe(1);
    snapshot = { memory: row("book:b"), revision };
    await expect(f.api.commands!.mutate(change)).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    snapshot = { memory: row(), revision: `mem1:${"b".repeat(64)}` };
    await expect(f.api.commands!.mutate(change)).rejects.toMatchObject({ code: "memory/conflict" });
    f.raw.queries.inspect = async () => { f.switchBook("b"); return { memory: row(), revision }; };
    await expect(f.api.commands!.mutate(change)).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect(writes).toBe(1);
  } finally { await f.close(); }
});

test.each(["book_memory_context", "reading_intent_context", "conversation_insights_context"] as ContextBundleKind[])(
  "book context %s can capture/read/export and its export remains fenced after delivery", async kind => {
    const f = fixture(); let lease: ResourceAccess | undefined;
    const bundle = await createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1,
      kind, scope: { kind: "book", id: "a" }, sourceRevision: "fixture", items: [], omissions: [] });
    f.raw.commands.context.capture = async () => ({ bundle, changed: true, persistence: "event-log" });
    f.raw.queries.context.read = async () => bundle;
    f.raw.queries.context.export = async (_query, _owner, _signal, access) => {
      lease = access; return { id: "context", source: "context", state: "ready", name: "context.json", mimeType: "application/json", size: 1, expiresAt: 1 };
    };
    try {
      const selector = { kind, scope: { kind: "book" as const, id: "a" } };
      expect((await f.api.commands!.context.capture(selector)).bundle).toEqual(bundle);
      expect(await f.api.queries.context.read({ ...selector, version: bundle.version })).toEqual(bundle);
      await f.api.queries.context.export({ ...selector, version: bundle.version });
      expect(f.listeners.size).toBe(1); expect(lease?.isAllowed()).toBe(true);
      f.switchBook("b"); expect(lease?.signal.aborted).toBe(true); expect(lease?.isAllowed()).toBe(false);
      lease?.dispose(); expect(f.listeners.size).toBe(0);
      expect(() => f.api.commands!.context.capture({ kind: "user_profile_context", scope: { kind: "user" } }))
        .toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
    } finally { lease?.dispose(); await f.close(); }
  },
);

test("graph execution remains tied to the original current-book session after its handle is returned", async () => {
  const gate = deferred(), entered = deferred(); let executionSignal: AbortSignal | undefined;
  const owner = new BookGraphTaskOwner<import("../../../platform/domain-actor").DomainActor>(async input => { executionSignal = input.signal; entered.resolve(); await gate.promise;
    return { status: "complete", eligible: 0, attempted: 0, digested: 0, remaining: 0, emptyChapters: [], failures: [] };
  }, () => {});
  const spy = spyOn(taskModule, "createBookGraphTasks").mockReturnValue(owner);
  const f = fixture(); spy.mockRestore();
  try {
    const task = await f.api.commands!.startGraphTask("a", "catch-up", { maxChapters: 1 }); await entered.promise;
    expect(f.listeners.size).toBe(1); expect(executionSignal?.aborted).toBe(false);
    f.switchBook("a", "a2"); expect(executionSignal?.aborted).toBe(true);
    gate.resolve(); await owner.whenSettled("a", task.taskId);
    expect((await owner.get("a", task.taskId)).status).toBe("cancelled");
    expect(f.listeners.size).toBe(0);
  } finally { gate.resolve(); owner.dispose(); await owner.drain(); await f.close(); }
});

test("memory observation rejects a book switch between its successful read and callback delivery", async () => {
  const f = fixture(), delivered: MemoryObservation[] = [];
  f.raw.queries.search = async () => [row()];
  let callback: ((event: MemoryObservation) => unknown) | undefined;
  let read: ((input: import("@read-aware/core").MemoryObservationQuery) => Promise<import("@read-aware/core").MemoryObservationResult>) | undefined;
  f.raw.events.observe = (_query, handler, authorizedRead) => { callback = handler; read = authorizedRead; return () => {}; };
  const query = { kind: "search" as const, query: { scopes: ["book:a" as const] } };
  const subscription = f.api.events.observe(query, event => { delivered.push(event); });
  try {
    const result = await read!(query); f.switchBook("b");
    await expect(Promise.resolve(callback!({ status: "ready", revision: 1, result }))).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect(delivered).toEqual([]); expect(f.listeners.size).toBe(0);
    await expect(read!(query)).rejects.toMatchObject({ code: "plugin/object-access-denied" });
  } finally { subscription.dispose(); await f.close(); }
});


test("durable graph creation and recovery require the same model grant as direct graph calls", async () => {
  const plan = { title: "Graph", steps: [{ id: "graph", kind: "book.graph" as const, bookId: "a", mode: "catch-up" as const }] };
  const record: jobStore.DurableJobRecord = { owner: "plugin:durable-graph-permissions", id: "saved", plan,
    state: { status: "queued", nextStep: 0, attempt: null, results: [], errorCode: null }, revision: "1", createdAt: "now", updatedAt: "now" };
  let writes = 0, reads = 0;
  const storage = spyOn(jobStore, "nativeDurableJobStore").mockReturnValue({
    create: async () => { writes++; return record; }, checkpoint: async () => { writes++; return record; },
    get: async () => { reads++; return structuredClone(record); }, list: async () => [structuredClone(record)],
  });
  const actor = buildPluginContext({ id: "durable-graph-permissions", name: "Graph", version: "1", schemaVersion: 1, requires: {}, permissions: ["memory:write"] }, "1", []);
  try {
    actor.lifecycle.promote();
    await expect(actor.context.services.jobs.start(plan)).rejects.toMatchObject({ code: "plugin/permission-denied" });
    await expect(actor.context.services.jobs.get("saved")).rejects.toMatchObject({ code: "plugin/permission-denied" });
    await expect(actor.context.services.jobs.control("saved", "resume")).rejects.toMatchObject({ code: "plugin/permission-denied" });
    expect((await actor.context.services.jobs.list()).jobs).toEqual([]);
    await Bun.sleep(0);
    expect(reads).toBeGreaterThan(3); // Includes activation recovery, before any execution preparation.
    expect(writes).toBe(0);
  } finally { actor.lifecycle.stop(); await actor.lifecycle.drainCleanups(); storage.mockRestore(); }
});


test("cancelling a durable control during lookup prevents persisting its intent", async () => {
  let gate = deferred(), entered = deferred(), writes = 0;
  const record: jobStore.DurableJobRecord = { owner: "plugin:job-control-cancel", id: "saved",
    plan: { title: "Graph", steps: [{ id: "graph", kind: "book.graph", bookId: "a", mode: "catch-up" }] },
    state: { status: "paused", nextStep: 0, attempt: null, results: [], errorCode: null }, revision: "1", createdAt: "now", updatedAt: "now" };
  const storage = spyOn(jobStore, "nativeDurableJobStore").mockReturnValue({
    create: async () => { throw Error("Unexpected create"); }, list: async () => [],
    get: async () => { entered.resolve(); await gate.promise; return structuredClone(record); },
    checkpoint: async () => { writes++; return record; },
  });
  const actor = buildPluginContext({ id: "job-control-cancel", name: "Graph", version: "1", schemaVersion: 1, requires: {}, permissions: ["memory:write", "service:llm"] }, "1", []);
  try {
    actor.lifecycle.promote();
    for (const action of ["pause", "resume", "cancel"] as const) {
      gate = deferred(); entered = deferred();
      const abort = new AbortController();
      const work = actor.context.services.jobs.control("saved", action, { signal: abort.signal });
      await entered.promise; abort.abort(Error("cancel review")); gate.resolve();
      await expect(work).rejects.toThrow("cancel review");
    }
    expect(writes).toBe(0);
  } finally { gate.resolve(); actor.lifecycle.stop(); await actor.lifecycle.drainCleanups(); storage.mockRestore(); }
});
