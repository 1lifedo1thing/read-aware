import { getDefaultStore } from "jotai";
import { contentProvidersAtom } from "../features/plugins/state/plugin-store";
import { onLocalKVChange } from "../platform/local-store";
import { onAppEvent } from "../platform/app-events";
import { onDomainEventBroadcast } from "../platform/domain-events";
import { durableWrites } from "../platform/write-settlement";
import { copyEventCause, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { observeQuery } from "./query-observation";
import { AppError, type BookContentState, type BookContentObservation } from "@read-aware/core";
import { getBookRecord } from "../features/library/lib/library-db";
import { getVirtualBookBinding, resolveContentProvider } from "../features/plugins/lib/virtual-books";
import { observeContentInvalidation, virtualSourceRevision } from "../features/library/lib/content-invalidation";
import { getDesktopBlobInfo } from "../platform/blob-store";
import { isTauri } from "../platform/environment";
import { afterLocalKVWrites } from "../platform/local-store";
import { createLogger } from "../platform/logger";

const log = createLogger("book-content-state");
function validate(bookId: string) {
  if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 256) throw new AppError("ui/invalid-target", "Invalid book ID");
}

export async function getBookContentState(bookId: string, signal?: AbortSignal): Promise<BookContentState> {
  validate(bookId); signal?.throwIfAborted();
  if (!isTauri()) throw new AppError("ui/unavailable", "Content state requires the desktop app");
  const book = await getBookRecord(bookId);
  if (!book) throw new AppError("library/book-not-found", "Book is not in the library");
  if (book.format === "virtual") {
    return afterLocalKVWrites(() => {
      signal?.throwIfAborted();
      const binding = getVirtualBookBinding(bookId);
      const provider = binding ? resolveContentProvider(binding) : null;
      return { bookId, source: "virtual", availability: !binding ? "missing" : provider ? "provider-registered" : "provider-unavailable",
        sourceRevision: virtualSourceRevision(bookId, provider, binding?.key ?? ""), contentVersion: null };
    });
  }
  const info = await getDesktopBlobInfo(`bookfile:${bookId}`);
  signal?.throwIfAborted();
  const contentVersion = info?.sha256 ? `sha256:${info.sha256}` : null;
  return { bookId, source: "file", availability: info ? "local" : "missing",
    sourceRevision: contentVersion ?? (info ? "unversioned" : "missing"), contentVersion };
}

/** Serial, latest-state observation; it is not a complete content-change log. */
export function createContentStateObserver(lifetime?: AbortSignal, deps = {
  read: getBookContentState,
  report: (error: unknown) => log.warn("Content state observation failed", error),
  schedule: (work: () => void) => {
    const timer = setTimeout(work, 1000);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    return () => clearTimeout(timer);
  },
}, origin?: DomainActor) {
  let count = 0;
  return (bookId: string, handler: (event: BookContentObservation) => unknown): (() => void) => {
    validate(bookId);
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("ui/superseded", "Observer owner retired");
    if (count >= 64) throw new AppError("ui/unavailable", "Too many content observers");
    count++;
    return observeQuery(() => deps.read(bookId, lifetime), event => handler(copyEventCause(event,
      event.status === "ready" ? { status: "ready", snapshot: event.result } : { status: "error", errorCode: event.errorCode })), {
      ...deps, failureCode: "internal", release: () => { count--; },
    }, lifetime, { origin, settle: signal => durableWrites.settle(signal), hasPending: () => durableWrites.size > 0,
      subscribe: notify => {
        const store = getDefaultStore();
        const stops = [
          observeContentInvalidation((id, source) => { if (id === bookId) notify(source); }),
          store.sub(contentProvidersAtom, () => notify(store.get(contentProvidersAtom))),
          onLocalKVChange((key, _value, source) => { if (key === "read-aware-virtual-books") notify(stampEventCause({}, source)); }),
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
