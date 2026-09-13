import type { MemoryObservationQuery } from "@read-aware/core";
import type { BookGraphTaskOwner } from "@read-aware/agent";
import { stampEventCause, type DomainActor } from "../platform/domain-actor";
import { onAppEvent } from "../platform/app-events";
import { onDomainEventBroadcast, type DomainEventBroadcast } from "../platform/domain-events";
import { durableWrites } from "../platform/write-settlement";
import { readingRuntime } from "./reading-runtime";
import type { QueryObservationSources } from "./query-observation";

export function affectsMemoryQuery(query: MemoryObservationQuery, event: DomainEventBroadcast): boolean {
  if (query.kind === "graphTask" || query.kind === "graphTasks") return false;
  if (event.type === "book.merged") return !("bookId" in query) || query.bookId === event.payload.keepId || query.bookId === event.payload.mergedId;
  if (event.type.startsWith("book.")) {
    if (query.kind !== "classification" && query.kind !== "bookGraph") return event.type === "book.removed";
    return "bookId" in event.payload && event.payload.bookId === query.bookId;
  }
  if (query.kind === "classification" || query.kind === "bookGraph") return false;
  if (query.kind === "profile") return event.type === "profile.updated" || event.type === "profile.onboarded";
  if (query.kind === "inspect" && event.type.startsWith("memory.")) return "memoryId" in event.payload && event.payload.memoryId === query.memoryId;
  // ID-only revisions/forgetting may leave a query's scope or ranking. Re-run
  // authorized reads rather than looking up foreign rows to recover old scope.
  return event.type.startsWith("memory.") || event.type.startsWith("entity.") || event.type.startsWith("profile.");
}

export function memoryObservationSources(query: MemoryObservationQuery, origin: DomainActor,
  tasks: Pick<BookGraphTaskOwner<DomainActor>, "subscribeChanges">): QueryObservationSources {
  return { origin, settle: signal => durableWrites.settle(signal), hasPending: () => durableWrites.size > 0,
    subscribe: notify => {
      if (query.kind === "graphTask" || query.kind === "graphTasks") return tasks.subscribeChanges((change, actor) => {
        if (change.bookId === query.bookId && (query.kind === "graphTasks" || change.taskId === query.taskId)) notify(stampEventCause({}, actor));
      });
      const stops = [onDomainEventBroadcast(event => { if (affectsMemoryQuery(query, event)) notify(event); }),
        onAppEvent("projections-invalidated", notify)];
      if (query.kind === "classification" || query.kind === "bookGraph") {
        stops.push(onAppEvent("book-changed", event => { if (event.bookId === query.bookId) notify(event); }));
      }
      if (query.kind === "bookGraph") {
        stops.push(onAppEvent("book-text-changed", event => { if (event.bookId === query.bookId) notify(event); }));
        let previousBook: string | null | undefined, previousKey: string | undefined;
        stops.push(readingRuntime.observe(snapshot => {
          const key = JSON.stringify([snapshot.sessionId, snapshot.bookId, snapshot.status, snapshot.location?.href]);
          const changed = previousKey !== undefined && key !== previousKey;
          const relevant = previousBook === query.bookId || snapshot.bookId === query.bookId;
          previousKey = key; previousBook = snapshot.bookId;
          // The first notification is ambient state, not a new cause. Preserve
          // an event-bound registration's own source on its initial query.
          if (changed && relevant) notify(snapshot);
        }));
      }
      return () => { for (const stop of stops) stop(); };
    } };
}
