import type { AnnotationObservationQuery } from "@read-aware/core";
import type { DomainActor } from "../platform/domain-actor";
import { onDomainEventBroadcast, type DomainEventBroadcast } from "../platform/domain-events";
import { onAppEvent } from "../platform/app-events";
import { durableWrites } from "../platform/write-settlement";
import { ANNOTATION_EVENTS } from "./events";
import type { QueryObservationSources } from "./query-observation";

const annotationEvents = new Set<string>(ANNOTATION_EVENTS);

export function affectsAnnotationQuery(query: AnnotationObservationQuery, event: DomainEventBroadcast): boolean {
  const bookId = query.kind === "page" ? query.query?.bookId : undefined;
  if (event.type === "book.merged") return !bookId || event.payload.keepId === bookId || event.payload.mergedId === bookId;
  if (event.type === "book.removed") return !bookId || event.payload.bookId === bookId;
  if (!annotationEvents.has(event.type)) return false;
  const payload = event.payload;
  if (query.kind === "inspect") {
    const id = "noteId" in payload ? payload.noteId : "askId" in payload ? payload.askId : "highlightId" in payload ? payload.highlightId : undefined;
    return id === query.annotationId;
  }
  // Edit/delete facts intentionally contain only the annotation ID. Such
  // changes conservatively invalidate pages; the authorized query and equality
  // check decide delivery. Do not read another book just to attribute a change.
  return !bookId || !("bookId" in payload) || payload.bookId === bookId;
}

export function annotationObservationSources(query: AnnotationObservationQuery, origin?: DomainActor): QueryObservationSources {
  return { origin, settle: signal => durableWrites.settle(signal), hasPending: () => durableWrites.size > 0,
    subscribe: notify => {
      const offDomain = onDomainEventBroadcast(event => { if (affectsAnnotationQuery(query, event)) notify(event); });
      const offProjection = onAppEvent("projections-invalidated", notify);
      return () => { offDomain(); offProjection(); };
    } };
}
