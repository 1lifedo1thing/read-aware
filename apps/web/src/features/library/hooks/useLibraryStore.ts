import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { actorFromEvent, causalActor, ObservationCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { onAppEvent } from "../../../platform/app-events";
import { scheduleCatchUpEnrichment } from "../lib/book-enrichment";
import { getBookRecord, listCollections, listLibraryBooks } from "../lib/library-db";
import { createProgressPatch } from "../lib/library-progress";
import type { BookProgress, LibraryBook } from "../lib/library-types";
import {
  libraryBooksAtom,
  libraryCollectionsAtom,
  libraryReadyAtom,
  patchBook,
  removeBooks,
  upsertBook,
} from "../state/library-store";

type LibraryStoreOptions = {
  reportError: (error: unknown) => void;
};

/**
 * Loads the shelf and keeps it current:
 * - a full reload at mount and on `library-changed` (sync pulls, plugin
 *   imports, merges — anything that rewrote rows wholesale);
 * - a single-row refresh on `book-changed` (a cover landed, the engine job
 *   filled metadata), so one tile repaints without re-reading the library;
 * - removal on `book-removed` from any path.
 *
 * Every load also queues engine jobs for books with an open question (no
 * cover verdict, PDF metadata never filled), which is how legacy and
 * interrupted imports catch up without the user opening them.
 */
export function useLibraryStore({ reportError }: LibraryStoreOptions) {
  const books = useAtomValue(libraryBooksAtom);
  const collections = useAtomValue(libraryCollectionsAtom);
  const libraryReady = useAtomValue(libraryReadyAtom);
  const setBooks = useSetAtom(libraryBooksAtom);
  const setCollections = useSetAtom(libraryCollectionsAtom);
  const setLibraryReady = useSetAtom(libraryReadyAtom);

  const reads = useRef({ causes: new ObservationCauses(), needsFull: false, full: false, ids: new Set<string>(), running: null as Promise<void> | null });
  const mounted = useRef(true);
  // Serialize reads. A notification during a query invalidates that sample;
  // resample the full projection with all pending causes before publishing.
  const refresh = useCallback((bookId: string | null, origin: DomainActor): Promise<void> => {
    const queue = reads.current;
    queue.causes.add(stampEventCause({}, causalActor(origin)));
    if (bookId === null || queue.needsFull) queue.full = true;
    else queue.ids.add(bookId);
    if (queue.running) return queue.running;
    queue.running = (async () => {
      while (mounted.current && (queue.full || queue.ids.size)) {
        const full = queue.full, ids = [...queue.ids], revision = queue.causes.revision;
        queue.full = false; queue.needsFull = false; queue.ids.clear();
        try {
          const [loadedBooks, loadedCollections] = full
            ? await Promise.all([listLibraryBooks(), listCollections()])
            : [await Promise.all(ids.map(getBookRecord)), null] as const;
          if (!mounted.current) return;
          if (revision !== queue.causes.revision) { queue.full = true; continue; }
          const source = actorFromEvent(queue.causes.take({}));
          if (loadedCollections) {
            const books = loadedBooks as LibraryBook[];
            setBooks(books, source);
            setCollections(loadedCollections, source);
            scheduleCatchUpEnrichment(books);
          } else {
            setBooks(current => loadedBooks.reduce((result, book, index) =>
              book ? upsertBook(result, book) : removeBooks(result, [ids[index]!]), current), source);
          }
        } catch (error) {
          if (!mounted.current) return;
          if (revision !== queue.causes.revision) { queue.full = true; continue; }
          // Leave causes pending for the next real refresh, without a retry loop.
          queue.needsFull = true;
          reportError(error);
        }
        if (mounted.current) setLibraryReady(true);
      }
    })().finally(() => { queue.running = null; });
    return queue.running;
  }, [reportError, setBooks, setCollections, setLibraryReady]);
  const loadLibrary = useCallback((origin: DomainActor = "system") => refresh(null, origin), [refresh]);
  const refreshBook = useCallback((bookId: string, origin: DomainActor = "system") => refresh(bookId, origin), [refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => onAppEvent("library-changed", event => void loadLibrary(actorFromEvent(event))), [loadLibrary]);
  useEffect(
    () => onAppEvent("book-changed", event => void refreshBook(event.bookId, actorFromEvent(event))),
    [refreshBook],
  );
  useEffect(
    () =>
      onAppEvent("book-removed", event => {
        const source = actorFromEvent(event);
        setBooks((current) => removeBooks(current, [event.bookId]), source);
        if (reads.current.running) void loadLibrary(source);
      }),
    [setBooks, loadLibrary],
  );

  const replaceBookInState = useCallback(
    (nextBook: LibraryBook) => setBooks((current) => upsertBook(current, nextBook)),
    [setBooks],
  );

  const applyOptimisticProgress = useCallback(
    (bookId: string, progress: BookProgress) => {
      const timestamp = new Date().toISOString();
      setBooks((current) =>
        patchBook(current, bookId, (book) => createProgressPatch(book, progress, timestamp)),
      );
    },
    [setBooks],
  );

  return {
    books,
    collections,
    libraryReady,
    loadLibrary,
    refreshBook,
    replaceBookInState,
    applyOptimisticProgress,
  };
}
