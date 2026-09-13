import { AppError } from "@read-aware/core";
import type { PluginBookAccess } from "@read-aware/plugin-types";

/** Stable error for an object scope that the user did not grant. */
export const PLUGIN_OBJECT_ACCESS_DENIED = "plugin/object-access-denied";

export type CurrentBookSnapshot = {
  bookId: string | null;
  sessionId: string | null;
};

export type PluginBookAccessFence = {
  /** Aborted when a live current-book/session grant changes mid-operation. */
  readonly signal?: AbortSignal;
  /** Reject a result that settled after the current reader changed. */
  assertUnchanged(options?: { retain?: boolean }): Promise<void>;
  /** Release the current-reader observer when the underlying operation fails. */
  dispose(): void;
};

export type PluginBookAccessFenceOptions = {
  /** A reload/open can replace the session while staying on the same book. */
  allowSessionChange?: boolean;
  /** A close can settle with no current reader after dispatch. */
  allowClose?: boolean;
};

export type PluginBookAccessPolicy = {
  readonly grant: PluginBookAccess;
  readonly restricted: boolean;
  /** Static check for operations whose target is already named by the caller. */
  assertBook(bookId: string, operation: string): void;
  /** Start an operation against a named book and fence its result. */
  beginBook(bookId: string, operation: string, options?: PluginBookAccessFenceOptions): Promise<PluginBookAccessFence>;
  /** Start an operation against the live reader book and fence its result. */
  beginCurrent(operation: string, options?: PluginBookAccessFenceOptions): Promise<PluginBookAccessFence>;
  /** A returned object must belong to this policy's permitted book. */
  assertReturnedBook(bookId: string | null | undefined, operation: string): void;
  /** Convert a library listing to the one object visible in book scope. */
  filterBooks<T extends { id: string }>(books: readonly T[], current?: CurrentBookSnapshot): T[];
};

export function pluginObjectAccessDenied(operation: string, bookId?: string): AppError {
  const target = bookId ? ` for book ${bookId}` : "";
  return new AppError(PLUGIN_OBJECT_ACCESS_DENIED, `${operation} is outside the plugin book grant${target}`);
}

function sameCurrent(before: CurrentBookSnapshot, after: CurrentBookSnapshot): boolean {
  return before.bookId === after.bookId && before.sessionId === after.sessionId;
}

/**
 * Book object policy shared by library, reading, annotations and resources.
 * The callback is deliberately host-owned: a plugin never supplies or
 * replaces the current-reader resolver.
 */
export function createPluginBookAccessPolicy(
  grant: PluginBookAccess,
  readCurrent: () => Promise<CurrentBookSnapshot>,
  observeCurrent?: (handler: (snapshot: CurrentBookSnapshot) => unknown) => () => void,
  readCurrentNow?: () => CurrentBookSnapshot,
): PluginBookAccessPolicy {
  const restricted = grant.mode !== "all";
  let currentSnapshot: CurrentBookSnapshot | null = readCurrentNow?.() ?? null;
  const currentForCheck = (): CurrentBookSnapshot | null => {
    if (readCurrentNow) currentSnapshot = readCurrentNow();
    return currentSnapshot;
  };

  const assertBook = (bookId: string, operation: string): void => {
    if (grant.mode === "all") return;
    if (typeof bookId !== "string" || !bookId.trim()) throw pluginObjectAccessDenied(operation);
    if (grant.mode === "current") {
      if (currentForCheck()?.bookId === bookId) return;
      throw pluginObjectAccessDenied(operation, bookId);
    }
    if (grant.mode === "book" && grant.bookId === bookId) return;
    throw pluginObjectAccessDenied(operation, bookId);
  };

  const fenced = (before: CurrentBookSnapshot, operation: string, currentTarget = false,
    options?: PluginBookAccessFenceOptions): PluginBookAccessFence => {
    if (grant.mode !== "current" && !currentTarget) return { assertUnchanged: async () => {}, dispose: () => {} };
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    let disposed = false;
    const allowedBookId = options?.allowClose ? null : options?.allowSessionChange ? before.bookId : undefined;
    const allowsExpectedTransition = (after: CurrentBookSnapshot) => allowedBookId !== undefined && after.bookId === allowedBookId;
    const changed = (after: CurrentBookSnapshot) => {
      currentSnapshot = after;
      if (!sameCurrent(before, after) && !allowsExpectedTransition(after) && !controller.signal.aborted) {
        controller.abort(pluginObjectAccessDenied(`${operation} (current reader changed)`, after.bookId ?? undefined));
      }
    };
    if (observeCurrent) dispose = observeCurrent(changed);
    // A resolver may have yielded while the reader changed. Some observer
    // implementations deliver their initial snapshot asynchronously, so do a
    // synchronous second read before the caller can dispatch a host write.
    if (readCurrentNow) changed(readCurrentNow());
    const release = () => {
      if (disposed) return;
      disposed = true;
      dispose?.();
    };
    return {
      signal: controller.signal,
      assertUnchanged: async (checkOptions) => {
        try {
          const after = await readCurrent();
          currentSnapshot = after;
          if (!sameCurrent(before, after) && !allowsExpectedTransition(after)) {
            throw pluginObjectAccessDenied(`${operation} (current reader changed)`, after.bookId ?? undefined);
          }
          controller.signal.throwIfAborted();
        } finally { if (!checkOptions?.retain) release(); }
      },
      dispose: release,
    };
  };

  const beginCurrent = async (operation: string, options?: PluginBookAccessFenceOptions): Promise<PluginBookAccessFence> => {
    if (grant.mode === "all") return { assertUnchanged: async () => {}, dispose: () => {} };
    const before = await readCurrent();
    currentSnapshot = before;
    if (!before.bookId) throw pluginObjectAccessDenied(operation);
    if (grant.mode === "book" && grant.bookId !== before.bookId) throw pluginObjectAccessDenied(operation, before.bookId);
    const fence = fenced(before, operation, true, options);
    try { fence.signal?.throwIfAborted(); } catch (error) { fence.dispose(); throw error; }
    return fence;
  };

  const beginBook = async (bookId: string, operation: string, options?: PluginBookAccessFenceOptions): Promise<PluginBookAccessFence> => {
    assertBook(bookId, operation);
    if (grant.mode !== "current") return { assertUnchanged: async () => {}, dispose: () => {} };
    const before = await readCurrent();
    currentSnapshot = before;
    if (before.bookId !== bookId) throw pluginObjectAccessDenied(operation, bookId);
    const fence = fenced(before, operation, false, options);
    try { fence.signal?.throwIfAborted(); } catch (error) { fence.dispose(); throw error; }
    return fence;
  };

  const assertReturnedBook = (bookId: string | null | undefined, operation: string): void => {
    if (grant.mode === "all") return;
    if (!bookId) throw pluginObjectAccessDenied(operation);
    if (grant.mode === "book" && grant.bookId === bookId) return;
    if (grant.mode === "current" && currentForCheck()?.bookId === bookId) return;
    throw pluginObjectAccessDenied(operation, bookId);
  };

  const filterBooks = <T extends { id: string }>(books: readonly T[], current?: CurrentBookSnapshot): T[] => {
    if (grant.mode === "all") return [...books];
    const id = grant.mode === "book" ? grant.bookId : (currentForCheck() ?? current)?.bookId;
    return id ? books.filter(book => book.id === id) : [];
  };

  return { grant, restricted, assertBook, beginBook, beginCurrent, assertReturnedBook, filterBooks };
}
