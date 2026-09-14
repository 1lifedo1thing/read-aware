import { AppError } from "./errors";

/** A local derived-text snapshot, not the book's live reader/search index. */
export type BookTextSnapshot = {
  bookId: string;
  contentVersion: string | null;
  status: "unprepared" | "preparing" | "ready" | "partial" | "unsupported" | "unavailable" | "error";
  /** Text can exist even when the chapter indexing policy retains no chapters. */
  text: "unknown" | "available" | "textless";
  chapterCount: number;
  progress: { total: number; completed: number; failed: number; unsupported: number } | null;
  errorCode?: string;
};

export type BookTextPriority = "normal" | "background";
export type BookTextWaitReason = "queue" | "reader" | null;
export type BookTextPrepareOptions = { rebuild?: boolean; priority?: BookTextPriority; timeoutMs?: number };
/** Shared by operation discovery and task admission. */
export function normalizeBookTextPrepareOptions(options: BookTextPrepareOptions = {}): Required<BookTextPrepareOptions> {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => !["rebuild", "priority", "timeoutMs"].includes(key))
    || options.rebuild !== undefined && typeof options.rebuild !== "boolean"
    || options.priority !== undefined && options.priority !== "normal" && options.priority !== "background") {
    throw new AppError("library/invalid-input", "Invalid text preparation options");
  }
  const timeoutMs = options.timeoutMs === undefined ? 30 * 60_000 : options.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 2 * 60 * 60_000) {
    throw new AppError("library/invalid-input", "Text timeout must be 1000..7200000 milliseconds");
  }
  return { rebuild: options.rebuild ?? false, priority: options.priority ?? "normal", timeoutMs };
}
/** One caller's ephemeral request, not ownership of all extraction for this book. */
export type BookTextTaskSnapshot = {
  taskId: string;
  bookId: string;
  mode: "prepare" | "rebuild";
  priority: BookTextPriority;
  /** Wall-clock deadline from admission, including queueing and pause. */
  timeoutMs: number;
  deadlineAt: string;
  waitReason: BookTextWaitReason;
  revision: number;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  textState: BookTextSnapshot;
  /** Persistence of the latest recorded milestone; separate from extraction completion. */
  history?: { status: "pending" | "saved" | "failed"; persistedRevision?: number; errorCode?: string };
  errorCode?: string;
};

/** Persisted metadata only; an old handle never grants control of a new request. */
export type BookTextTaskHistoryEntry = {
  snapshot: BookTextTaskSnapshot;
  recordedAt: string;
  requestAvailable: boolean;
  interrupted: boolean;
};
export type BookTextTaskHistoryQuery = { offset?: number; limit?: number };
export type BookTextTaskHistoryPage = { items: BookTextTaskHistoryEntry[]; total: number; nextOffset: number | null; retainedLimit: number };
