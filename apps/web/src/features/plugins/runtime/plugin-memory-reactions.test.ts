import { expect, spyOn, test } from "bun:test";
import { AppError, type MemorySnapshot } from "@read-aware/core";
import { BookGraphTaskOwner } from "@read-aware/agent";
import { buildPluginContext } from "./plugin-context";
import { createMemoryDomain } from "../../../domain/memory";
import { actorCause, type DomainActor } from "../../../platform/domain-actor";
import * as environment from "../../../platform/environment";
import * as ipc from "../../../platform/ipc";
import * as tasks from "../../../domain/book-graph-tasks";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const revision = (n: number) => `mem1:${n.toString(16).padStart(64, "0")}`;

test.each(["all", "book"] as const)("public memory %s-grant observations stop cross-plugin cycles without blocking independent user changes", async mode => {
  const records = new Map<string, MemorySnapshot>(); let writes = 0;
  for (const id of ["a", "b"]) records.set(id, { revision: revision(0), memory: { id, scope: "book:book", kind: "fact", content: "initial",
    importance: 0.5, evidenceCount: 1, createdAt: "now", updatedAt: "now" } });
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const invoke = spyOn(ipc, "invoke").mockImplementation(async (command, raw) => {
    const args = raw as any;
    if (command === "local_device_get") return { deviceId: "memory-reactions", lastHlcWallMs: null, lastHlcCounter: null } as never;
    if (command === "memory_inspect") return structuredClone(records.get(args.id) ?? null) as never;
    if (command === "memory_commit") {
      const event = args.event, record = records.get(event.payload.memoryId)!;
      if (record.revision !== args.expectedRevision) throw new AppError("memory/conflict", "Concurrent change");
      expect(event.type).toBe("memory.revised"); expect(typeof event.origin).toBe("string"); expect(event).not.toHaveProperty("cause");
      record.memory.content = event.payload.content; record.revision = revision(++writes);
      return { memoryId: record.memory.id, revision: record.revision } as never;
    }
    throw Error(`Unexpected IPC ${command}`);
  });
  const make = (id: string) => {
    const runtime = buildPluginContext({ id, name: id, version: "1", schemaVersion: 1, requires: {}, permissions: ["memory:write"] }, "1", [],
      mode === "book" ? { mode: "book", bookId: "book" } : { mode: "all" });
    runtime.lifecycle.promote(); return runtime;
  };
  const a = make("memory-a"), b = make("memory-b"), ready = [deferred(), deferred()];
  let done = deferred(), cycles = 0, automatic = 0;
  const errors: unknown[] = [], roots: string[] = [];
  try {
    [a, b].forEach((runtime, index) => {
      const watched = index === 0 ? "a" : "b", target = index === 0 ? "b" : "a"; let initial = true;
      runtime.context.domains.memory!.events.observe({ kind: "inspect", memoryId: watched }, async (snapshot, delivery) => {
        try {
          expect("reaction" in snapshot).toBe(false);
          if (snapshot.status !== "ready" || snapshot.result.kind !== "inspect" || !snapshot.result.snapshot) throw Error("Expected memory");
          if (initial) { initial = false; ready[index]!.resolve(); return; }
          if (delivery?.reaction?.status === "cycle") {
            expect(index).toBe(0); expect(() => runtime.context.withEvent(delivery)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
            cycles++; done.resolve(); return;
          }
          const bound = runtime.context.withEvent(delivery);
          if (index === 0) roots.push(actorCause(runtime.reactions.actor(delivery!.reaction!))!.root);
          await Promise.resolve();
          const observed = await bound.domains.memory!.queries.inspect(target);
          await bound.domains.memory!.commands!.mutate({ op: "correct", memoryId: target, expectedRevision: observed!.revision,
            content: `reaction:${++automatic}` });
        } catch (error) { errors.push(error); ready[index]!.resolve(); done.resolve(); }
      });
    });
    await Promise.all(ready.map(item => item.promise)); expect(errors).toEqual([]);
    const user = createMemoryDomain("user");
    for (let n = 0; n < 2; n++) {
      done = deferred(); await user.commands.mutate({ op: "correct", memoryId: "a", expectedRevision: records.get("a")!.revision, content: `user:${n}` });
      await done.promise; expect(errors).toEqual([]); expect(cycles).toBe(n + 1);
      await Promise.all([a.reactions.drain(), b.reactions.drain()]);
    }
    expect(writes).toBe(6); expect(automatic).toBe(4); expect(roots).toHaveLength(2); expect(roots[0]).not.toBe(roots[1]);
  } finally {
    a.lifecycle.stop(); b.lifecycle.stop(); await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]); invoke.mockRestore(); native.mockRestore();
  }
}, 20000);

test("public graph observation can cancel a running task after await and its terminal feedback retains that cause", async () => {
  let gate = deferred(), done = deferred(), cycles = 0;
  const owners: BookGraphTaskOwner<DomainActor>[] = [], errors: unknown[] = [], contexts: DomainActor[] = [];
  const factory = spyOn(tasks, "createBookGraphTasks").mockImplementation(lifetime => {
    const owner = new BookGraphTaskOwner<DomainActor>(async (input, actor) => {
      contexts.push(actor!); input.onStarted(); await gate.promise;
      return { status: "complete", eligible: 0, attempted: 0, digested: 0, remaining: 0, emptyChapters: [], failures: [] };
    }, () => {}, lifetime); owners.push(owner); return owner;
  });
  const runtime = buildPluginContext({ id: "graph-reactions", name: "Graphs", version: "1", schemaVersion: 1, requires: {},
    permissions: ["memory:write", "service:llm"] }, "1", [], { mode: "book", bookId: "book" });
  factory.mockRestore(); runtime.lifecycle.promote(); const ready = deferred();
  try {
    runtime.context.domains.memory!.events.observe({ kind: "graphTasks", bookId: "book" }, async (event, delivery) => {
      try {
        if (event.status !== "ready" || event.result.kind !== "graphTasks") throw Error("Expected task list");
        const task = event.result.tasks.at(-1); if (!task) { ready.resolve(); return; }
        if (task.status === "cancelled") {
          expect(delivery?.reaction?.status).toBe("cycle");
          expect(() => runtime.context.withEvent(delivery)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
          cycles++; done.resolve(); return;
        }
        if (task.status !== "running") return;
        const bound = runtime.context.withEvent(delivery); await Promise.resolve();
        expect((await bound.domains.memory!.commands!.cancelGraphTask("book", task.taskId)).status).toBe("cancelling");
        gate.resolve();
      } catch (error) { errors.push(error); gate.resolve(); ready.resolve(); done.resolve(); }
    });
    await ready.promise;
    for (let i = 0; i < 2; i++) {
      gate = deferred(); done = deferred();
      await runtime.context.domains.memory!.commands!.startGraphTask("book", "catch-up");
      await done.promise; expect(errors).toEqual([]); expect(cycles).toBe(i + 1);
    }
    expect(owners).toHaveLength(1); expect(contexts).toHaveLength(2);
    expect(actorCause(contexts[0])!.root).not.toBe(actorCause(contexts[1])!.root);
  } finally { gate.resolve(); runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); await Promise.all(owners.map(owner => owner.drain())); }
}, 15000);
