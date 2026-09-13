import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { AnnotationObserver } from "./annotation-observer";
import { affectsAnnotationQuery, annotationObservationSources } from "./annotation-observation-sources";
import { actorCause, causalActor, eventCause, reactionActor, stampEventCause } from "../platform/domain-actor";
import { broadcastDomainEventDrafts } from "../platform/domain-events";
import { emitAppEvent } from "../platform/app-events";
import { WriteSettlement } from "../platform/write-settlement";
import type { QueryObservation } from "./query-observation";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const gate = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const timers = new Set<() => void>(), listeners = new Set<(source: object) => void>(), errors: unknown[] = [];
  const writes = new WriteSettlement();
  const observer = new AnnotationObserver({ schedule: fn => { timers.add(fn); return () => { timers.delete(fn); }; }, report: error => { errors.push(error); } });
  const sources = { subscribe: (fn: (source: object) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    settle: (signal: AbortSignal) => writes.settle(signal), hasPending: () => writes.size > 0 };
  return { observer, sources, writes, timers, listeners, errors,
    notify: (source: object) => { for (const listener of listeners) listener(source); },
    next: async () => { const pending = [...timers]; timers.clear(); pending.forEach(fn => fn()); await tick(); } };
}

test("reads wait for native receipts and retain a write's original reaction through callback retry", async () => {
  const f = fixture(), completed = gate(), root = stampEventCause({}), actor = reactionActor("plugin:a", "rule", eventCause(root)!);
  const seen: QueryObservation<number>[] = []; let reads = 0, value = 1, fail = true;
  const write = f.writes.run(async () => { await completed.promise; f.notify(stampEventCause({}, actor)); });
  const stop = f.observer.observeSnapshot(async () => { reads++; return value; }, event => {
    seen.push(event); if (fail) { event.revision = 999; throw Error("retry"); }
  }, undefined, f.sources);
  await tick(); expect(reads).toBe(0);
  completed.resolve(); await write; await tick(); expect(seen).toHaveLength(1);
  fail = false; await f.next(); expect(seen).toHaveLength(2);
  expect(seen[1]?.revision).toBe(2); expect(eventCause(seen[1]!)?.root).toBe(eventCause(root)!.root);
  expect(() => reactionActor("plugin:a", "rule", eventCause(seen[1]!)!)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
  value = 2; f.notify(stampEventCause({})); await f.next();
  expect(() => reactionActor("plugin:a", "rule", eventCause(seen[2]!)!)).not.toThrow();
  stop(); expect(f.listeners.size).toBe(0); expect(f.timers.size).toBe(0);
});

test("a read spanning a new commit is discarded without losing its cause or overlapping reads", async () => {
  const f = fixture(), first = gate<number>(), seen: QueryObservation<number>[] = []; let reads = 0;
  const root = causalActor("plugin:changed"), source = stampEventCause({}, root);
  const stop = f.observer.observeSnapshot(() => ++reads === 1 ? first.promise : Promise.resolve(2), event => { seen.push(event); }, undefined, f.sources);
  await tick(); f.notify(source); first.resolve(1); await tick();
  expect(seen).toEqual([]); expect(reads).toBe(1); await f.next();
  expect(seen).toEqual([{ status: "ready", result: 2, revision: 1 }]);
  expect(eventCause(seen[0]!)?.root).toBe(actorCause(root)!.root); stop();
});

test("stable read errors retain unread causes through recovery; unchanged ready reads retire unrelated causes", async () => {
  const f = fixture(), seen: QueryObservation<number>[] = []; let value = 1, failed = false;
  const stop = f.observer.observeSnapshot(async () => { if (failed) throw new AppError("db/locked", "private"); return value; }, event => { seen.push(event); }, undefined, f.sources);
  await tick();
  const root = stampEventCause({}), actor = reactionActor("plugin:a", "rule", eventCause(root)!);
  f.notify(stampEventCause({}, actor)); value = 2; failed = true;
  await f.next(); await f.next(); expect(seen).toHaveLength(2);
  failed = false; await f.next(); expect(seen).toHaveLength(3);
  expect(eventCause(seen[2]!)?.root).toBe(eventCause(root)!.root);
  f.notify(stampEventCause({}, actor)); await f.next(); expect(seen).toHaveLength(3);
  value = 3; await f.next();
  expect(eventCause(seen[3]!)?.root).not.toBe(eventCause(root)!.root);
  expect(JSON.stringify(seen)).not.toContain("private"); stop();
});

test("retirement aborts settlement, releases quota and unsubscribes without cancelling the actual write", async () => {
  const f = fixture(), completed = gate(), life = new AbortController(); let reads = 0;
  const work = f.writes.run(() => completed.promise);
  const stop = f.observer.observeSnapshot(async () => ++reads, () => {}, life.signal, f.sources);
  await tick(); life.abort(); stop(); await tick();
  expect(reads).toBe(0); expect(f.listeners.size).toBe(0); expect(f.timers.size).toBe(0); expect(f.writes.size).toBe(1);
  expect(f.errors).toEqual([]); completed.resolve(); await work;
  const bad = { ...f.sources, subscribe: () => { throw Error("registration failed"); } };
  for (let i = 0; i < 65; i++) expect(() => f.observer.observeSnapshot(async () => 1, () => {}, undefined, bad)).toThrow("registration failed");
  const next = f.observer.observeSnapshot(async () => ++reads, () => {}, undefined, f.sources); await tick(); expect(reads).toBe(1); next();
});

test("annotation dependencies filter known books and IDs, retaining local and remote/restore provenance", () => {
  const query = { kind: "page" as const, query: { bookId: "b" } }, seen: object[] = [];
  const stop = annotationObservationSources(query).subscribe(source => { seen.push(source); });
  const origin = causalActor("plugin:source");
  broadcastDomainEventDrafts([
    { type: "note.created", payload: { noteId: "n", bookId: "other", body: "other" }, origin },
    { type: "note.created", payload: { noteId: "n", highlightId: "h", bookId: "b", body: "here" }, origin },
    { type: "note.updated", payload: { noteId: "unknown-book", body: "changed" }, origin },
    { type: "book.merged", payload: { keepId: "b", mergedId: "old" }, origin },
  ]);
  emitAppEvent("projections-invalidated", { source: "remote" }, origin);
  emitAppEvent("projections-invalidated", { source: "restore" }, origin);
  expect(seen).toHaveLength(5); expect(seen.every(event => eventCause(event)?.root === actorCause(origin)!.root)).toBe(true);
  const linkedNote = { type: "note.created" as const, payload: { noteId: "n", highlightId: "h", bookId: "b", body: "note" }, origin: "user" as const, createdAt: "now" };
  expect(affectsAnnotationQuery({ kind: "inspect", annotationId: "n" }, linkedNote)).toBe(true);
  expect(affectsAnnotationQuery({ kind: "inspect", annotationId: "h" }, linkedNote)).toBe(false);
  stop(); emitAppEvent("projections-invalidated", { source: "restore" }, origin); expect(seen).toHaveLength(5);
});
