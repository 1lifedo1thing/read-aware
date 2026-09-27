/**
 * One opening of the reader engine: from the moment a book is handed to
 * foliate until that engine is torn down.
 *
 * Opening is a long asynchronous sequence (create the view, parse, open,
 * restore, bind the runtime), and a newer opening can replace it at any await.
 * The session is the single owner of that lifetime: the opening checks
 * `closed` after each await, and registers what it acquires the moment it has
 * it. Closing happens in two phases —
 *
 *   1. bindings (`onClose`): listeners, subscriptions and runtime bindings that
 *      point INTO the engine are undone first, in registration order;
 *   2. resources (`onRelease`): the engine's own resources — the view, the
 *      parsed book — are released after every binding is gone, in
 *      acquisition order (the view is closed before the book it renders).
 *
 * Each teardown runs once. One registered after the close — an await that
 * resolved after the replacement began — runs at once, so a late acquisition
 * is released rather than leaked.
 */

import type { ReadingMode } from "../../settings/lib/reader-settings";

/**
 * What an engine session is FOR. A change to any of these is a different
 * engine: another source file, another library book, or another layout (a
 * reading-mode switch re-opens and restores from the live position). Nothing
 * else is — callbacks, settings, UI state and translations are read at event
 * time and must never re-open the book.
 */
export type ReaderEngineKey<Source> = {
  /** The loaded book object handed to the engine (file or virtual content). */
  source: Source;
  bookId: string | null;
  readingMode: ReadingMode;
};

/** Receives the actor retiring the session, when one is known. */
export type ReaderEngineTeardown<Origin> = (origin: Origin | undefined) => void;

export class ReaderEngineSession<Source, Origin = unknown> {
  readonly key: ReaderEngineKey<Source>;
  #closed = false;
  readonly #bindings: ReaderEngineTeardown<Origin>[] = [];
  readonly #resources: ReaderEngineTeardown<Origin>[] = [];

  constructor(key: ReaderEngineKey<Source>) {
    this.key = key;
  }

  /** True once a replacement or unmount retired this session. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Undo a binding into the engine when the session closes (phase 1) —
   *  immediately when it already has. */
  onClose(teardown: ReaderEngineTeardown<Origin>): void {
    if (this.#closed) teardown(undefined);
    else this.#bindings.push(teardown);
  }

  /** Release an engine resource once every binding is undone (phase 2) —
   *  immediately when the session already closed. */
  onRelease(teardown: ReaderEngineTeardown<Origin>): void {
    if (this.#closed) teardown(undefined);
    else this.#resources.push(teardown);
  }

  /** Retire the session. Idempotent. A teardown that throws does not keep the
   *  rest from running; the first failure is rethrown after all have run. */
  close(origin?: Origin): void {
    if (this.#closed) return;
    this.#closed = true;
    const teardowns = [...this.#bindings.splice(0), ...this.#resources.splice(0)];
    let failure: { error: unknown } | null = null;
    for (const teardown of teardowns) {
      try {
        teardown(origin);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  }
}
