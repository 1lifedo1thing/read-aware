import { observeQuery } from "./query-observation";
import { onAppEvent } from "../platform/app-events";
import { onDomainEventBroadcast } from "../platform/domain-events";
import { durableWrites } from "../platform/write-settlement";
import { causalActor, copyEventCause, type DomainActor } from "../platform/domain-actor";
import { AppError, type BookEnrichmentSnapshot, type BookEnrichmentReceipt,
  type BookEnrichmentObservation } from "@read-aware/core";
import { getBookRecord, hasLocalBookFile } from "../features/library/lib/library-db";
import { enrichmentQueue, ENRICHMENT_FORMATS, metadataNeedsEnrichment } from "../features/library/lib/book-enrichment";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";

const log = createLogger("enrichment-control");
function validate(id: string) {
  if (typeof id !== "string" || !id.trim() || id.length > 256) throw new AppError("ui/invalid-target", "Invalid book ID");
  if (!isTauri()) throw new AppError("ui/unavailable", "Enrichment requires the desktop app");
}

export async function getBookEnrichment(bookId: string, signal?: AbortSignal): Promise<BookEnrichmentSnapshot> {
  validate(bookId); signal?.throwIfAborted();
  const book = await getBookRecord(bookId);
  if (!book) throw new AppError("reader/book-not-found", "Book not found");
  const sourceLocal = await hasLocalBookFile(bookId);
  signal?.throwIfAborted();
  return { bookId, cover: { status: book.coverStatus, local: book.coverStatus === "ready" && book.coverLocal },
    metadataPending: metadataNeedsEnrichment(book), supported: ENRICHMENT_FORMATS.has(book.format), sourceLocal,
    job: enrichmentQueue.snapshot(bookId) };
}

export async function retryBookEnrichment(bookId: string, origin: DomainActor, signal?: AbortSignal): Promise<BookEnrichmentReceipt> {
  origin = causalActor(origin);
  const snapshot = await getBookEnrichment(bookId, signal);
  signal?.throwIfAborted();
  if (["queued", "running"].includes(snapshot.job.phase)) return { status: "already-running", snapshot };
  if (!snapshot.supported || !snapshot.sourceLocal) return { status: "unavailable", snapshot };
  const cover = snapshot.cover.status === "unchecked", metadata = snapshot.metadataPending;
  if (!cover && !metadata) return { status: "not-needed", snapshot };
  const entry = enrichmentQueue.enqueue({ bookId, cover, metadata, origin });
  return { status: "queued", snapshot: { ...snapshot, job: { ...entry.job } } };
}

/** Poll persisted cover/local-file state as well as this process's shared task state. */
export function createEnrichmentObserver(lifetime?: AbortSignal, origin?: DomainActor) {
  let count = 0;
  return (bookId: string, handler: (event: BookEnrichmentObservation) => unknown): (() => void) => {
    validate(bookId);
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("ui/superseded", "Observer owner retired");
    if (count >= 64) throw new AppError("ui/unavailable", "Too many enrichment observers");
    count++;
    return observeQuery(() => getBookEnrichment(bookId, lifetime), event => handler(copyEventCause(event,
      event.status === "ready" ? { status: "ready", snapshot: event.result } : { status: "error", errorCode: event.errorCode })), {
      failureCode: "internal", report: error => log.warn("Enrichment observation failed", error), release: () => { count--; },
      schedule: work => { const timer = setTimeout(work, 1000); if (typeof timer === "object" && "unref" in timer) timer.unref(); return () => clearTimeout(timer); },
    }, lifetime, { origin, settle: signal => durableWrites.settle(signal), hasPending: () => durableWrites.size > 0,
      subscribe: notify => {
        const stops = [
          enrichmentQueue.observe((id, source) => { if (id === bookId) notify(source); }),
          onAppEvent("book-changed", event => { if (event.bookId === bookId) notify(event); }),
          onAppEvent("book-removed", event => { if (event.bookId === bookId) notify(event); }),
          onAppEvent("library-changed", notify), onAppEvent("projections-invalidated", notify),
          onDomainEventBroadcast(event => {
            if (event.type === "book.merged" ? event.payload.keepId === bookId || event.payload.mergedId === bookId
              : event.type.startsWith("book.") && "bookId" in event.payload && event.payload.bookId === bookId) notify(event);
          }),
        ];
        return () => { stops.forEach(stop => stop()); };
      },
    });
  };
}
