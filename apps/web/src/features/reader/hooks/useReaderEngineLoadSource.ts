import { useLayoutEffect, useRef } from "react";
import { readingRuntime } from "../../../domain/reading-runtime";
import { actorFromEvent, causalActor, eventCause, type DomainActor } from "../../../platform/domain-actor";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import type { LoadedBook } from "../lib/reader-types";

/** A committed layout switch owns both teardown and the replacement load.
 * Capture before passive cleanup, and before any asynchronous parser/font work.
 * Unrelated appearance updates and StrictMode replay keep the same identity. */
export function useReaderEngineLoadSource(book: LoadedBook | null | undefined, bookId: string | undefined,
  mode: ReadingMode, settings: ReaderSettings) {
  const source = useRef<{ book: LoadedBook; bookId: string | undefined; sessionId: string | null; mode: ReadingMode; origin: DomainActor } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!book) { source.current = undefined; return; }
    const session = readingRuntime.snapshot();
    const sessionId = session.bookId === bookId ? session.sessionId : null;
    const previous = source.current;
    const sameBook = previous?.book === book && previous.bookId === bookId && previous.sessionId === sessionId;
    if (sameBook && previous.mode === mode) return;
    const origin = sameBook ? eventCause(settings) ? actorFromEvent(settings) : causalActor("system")
      : sessionId ? readingRuntime.openingActor(sessionId) : causalActor("system");
    source.current = { book, bookId, sessionId, mode, origin };
  }, [book, bookId, mode, settings]);
  return source;
}
