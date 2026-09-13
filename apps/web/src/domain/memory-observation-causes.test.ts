import { expect, test } from "bun:test";
import { BookGraphTaskOwner } from "@read-aware/agent";
import { AppError, type MemoryObservation } from "@read-aware/core";
import { MemoryObserver } from "./memory-observer";
import { memoryObservationSources } from "./memory-observation-sources";
import { readingRuntime } from "./reading-runtime";
import { actorCause, causalActor, eventCause, reactionActor, type DomainActor } from "../platform/domain-actor";
import { broadcastDomainEventDrafts } from "../platform/domain-events";
import { emitAppEvent } from "../platform/app-events";
import { durableWrites } from "../platform/write-settlement";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const report = { status: "complete" as const, eligible: 0, attempted: 0, digested: 0, remaining: 0, emptyChapters: [], failures: [] };

test("memory reads wait for writes and retain committed provenance through stable errors and callback retries", async () => {
  const timers = new Set<() => void>(), seen: MemoryObservation[] = [], errors: unknown[] = [];
  const observer = new MemoryObserver({ schedule: run => { timers.add(run); return () => { timers.delete(run); }; }, report: error => { errors.push(error); } });
  const next = async () => { const runs = [...timers]; timers.clear(); runs.forEach(run => run()); await tick(); };
  const owner = new BookGraphTaskOwner<DomainActor>(async () => report, () => {});
  const root = causalActor("user"), actor = reactionActor("plugin:memory", "rule", actorCause(root)!);
  let reads = 0, failedRead = true, failedCallback = false;
  const gate = deferred(), write = durableWrites.run(async () => { await gate.promise;
    broadcastDomainEventDrafts([{ type: "memory.revised", payload: { memoryId: "m", content: "new" }, origin: actor }]);
  });
  const stop = observer.observe({ kind: "inspect", memoryId: "m" }, async () => {
    reads++; if (failedRead) throw new AppError("db/locked", "private"); return { kind: "inspect", snapshot: null };
  }, event => { seen.push(event); if (failedCallback) throw Error("retry"); }, undefined,
  query => memoryObservationSources(query, "plugin:memory", owner));
  try {
    await tick(); expect(reads).toBe(0); gate.resolve(); await write; await tick();
    await next(); expect(seen).toHaveLength(1);
    failedRead = false; failedCallback = true; await next(); failedCallback = false; await next();
    expect(seen).toHaveLength(3); expect(seen.at(-1)?.status).toBe("ready");
    expect(eventCause(seen.at(-1)!)?.root).toBe(actorCause(root)!.root);
    expect(() => reactionActor("plugin:memory", "rule", eventCause(seen.at(-1)!)!)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
    expect(JSON.stringify(seen)).not.toContain("private");
  } finally { gate.resolve(); await write; stop(); owner.dispose(); }
});

test("graph observation sources follow only their book's text, location and domain changes", () => {
  const owner = new BookGraphTaskOwner<DomainActor>(async () => report, () => {}), seen: object[] = [];
  const root = causalActor("user"), request = reactionActor("plugin:source", "source", actorCause(root)!);
  const stop = memoryObservationSources({ kind: "bookGraph", bookId: "b" }, request, owner).subscribe(event => { seen.push(event); });
  try {
    expect(seen).toEqual([]);
    emitAppEvent("book-text-changed", { bookId: "other" }, request);
    emitAppEvent("book-text-changed", { bookId: "b" }, request);
    broadcastDomainEventDrafts([{ type: "book.narrativityClassified", payload: { bookId: "b", narrativity: "narrative" }, origin: request }]);
    const session = readingRuntime.begin("b", undefined, request);
    readingRuntime.attach(session, { navigate: async () => ({ bookId: "b", contentVersion: "v", href: "one" }),
      step: async () => ({ bookId: "b", contentVersion: "v", href: "one" }) }, { bookId: "b", contentVersion: "v", href: "one" });
    readingRuntime.relocate(session, { bookId: "b", contentVersion: "v", href: "two" }, "", undefined, undefined, request);
    expect(seen).toHaveLength(5); expect(seen.every(event => eventCause(event)?.root === actorCause(root)!.root)).toBe(true);
    const count = seen.length; stop(); emitAppEvent("projections-invalidated", { source: "restore" }, request); expect(seen).toHaveLength(count);
  } finally { stop(); owner.dispose(); readingRuntime.closed(); }
});

test("graph task sources filter owner/book/ID and preserve cancellation through terminal feedback", async () => {
  const gate = deferred(), owner = new BookGraphTaskOwner<DomainActor>(async input => { input.onStarted(); await gate.promise; return report; }, () => {});
  const root = causalActor("user"), seen: object[] = [];
  const task = await owner.start("b", "catch-up", undefined, undefined, root);
  const stop = memoryObservationSources({ kind: "graphTask", bookId: "b", taskId: task.taskId }, "plugin:watch", owner).subscribe(event => { seen.push(event); });
  try {
    await owner.start("other", "catch-up", undefined, undefined, causalActor("user")); expect(seen).toEqual([]);
    const cancellation = reactionActor("plugin:watch", "watch", actorCause(root)!);
    await owner.cancel("b", task.taskId, cancellation); gate.resolve(); await owner.drain();
    expect(seen).toHaveLength(2);
    expect(seen.every(event => eventCause(event)?.steps.includes("watch"))).toBe(true);
    stop(); await owner.start("b", "catch-up"); await owner.drain(); expect(seen).toHaveLength(2);
  } finally { gate.resolve(); stop(); owner.dispose(); await owner.drain(); }
});
