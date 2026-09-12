import { AppError } from "@read-aware/core";
import { validBackupPassword } from "./backup-password";
import type { BackupReviewPage, BackupReviewQuery } from "./backup-review-types";

export type FullBackupImportProgress = "decrypting" | "checkingSource" | "comparingEvents" | "comparingRows" | "comparingFiles" | "preparingReview";
export type BackupSourceSummary = {
  format: 2; schemaVersion: number; tables: Record<string, number>;
  events: number; blobs: number; credentials: number; pluginPrograms: number;
};
export type BackupComparisonCounts = { sourceOnly: number; targetOnly: number; same: number; different: number; unavailable: number };
export type BackupPlanSummary = {
  newEvents: number; existingEvents: number; conflictingEvents: number;
  tables: Record<string, { sourceRows: number; targetRows: number; comparisons: BackupComparisonCounts | null; generatedOnly: number }>;
  files: BackupComparisonCounts; pluginPrograms: number;
};
export type BackupSourceReceipt = BackupSourceSummary & { taskId: string };
export type BackupPlanReceipt = BackupPlanSummary & { taskId: string };
type Dependencies = {
  id(): string;
  selectSource(): Promise<string | null>;
  open(taskId: string, source: string, password: string, progress: (update: FullBackupImportProgress) => void): Promise<BackupSourceReceipt>;
  /** Holds the capture fences only around physical target planning. */
  plan(taskId: string, progress: (update: FullBackupImportProgress) => void, signal?: AbortSignal): Promise<BackupPlanReceipt>;
  read(taskId: string, query: BackupReviewQuery): Promise<BackupReviewPage>;
  cancel(taskId: string): Promise<void>;
  warn(message: string, error: unknown): void;
};
export type FullBackupReview = {
  readonly source: BackupSourceSummary;
  readonly plan: BackupPlanSummary;
  /** Admission has closed; await dispose() for the physical cleanup receipt. */
  readonly disposed: boolean;
  read(query: BackupReviewQuery, signal?: AbortSignal): Promise<BackupReviewPage>;
  dispose(): Promise<void>;
};

/** Preparation only. A returned review retains native private data; it is not
 * a completed import, executable approval or actor-visible resource. */
export function createFullBackupImport(deps: Dependencies) {
  return async (password: string, signal?: AbortSignal, onProgress?: (update: FullBackupImportProgress) => void): Promise<FullBackupReview | null> => {
    signal?.throwIfAborted();
    if (!validBackupPassword(password)) throw new AppError("backup/password-policy", "Invalid backup password length");
    const sourcePath = await deps.selectSource();
    signal?.throwIfAborted();
    if (sourcePath === null) return null;
    const taskId = deps.id();
    let retained = false, disposed = false, cancelling: Promise<void> | undefined, disposal: Promise<void> | undefined;
    let reads = Promise.resolve(), pendingReads = 0;
    const cancel = (): Promise<void> => cancelling ??= Promise.resolve().then(() => deps.cancel(taskId))
      .catch(error => deps.warn("Full backup import cleanup failed", error))
      .finally(() => { cancelling = undefined; });
    const dispose = (): Promise<void> => disposal ??= (async () => {
      disposed = true; signal?.removeEventListener("abort", abort);
      const retirement = pendingReads > 0 ? cancel() : undefined;
      await reads; await retirement; await cancelling;
      // A cancel during a native read retires it on physical completion. Retry
      // after that receipt if an earlier cancellation IPC could not reach it.
      await cancel();
    })();
    const abort = () => { void (retained ? dispose() : cancel()); };
    const progress = (update: FullBackupImportProgress) => {
      if (signal?.aborted) { abort(); return; }
      try { onProgress?.(update); }
      catch (error) { deps.warn("Full backup import observer failed", error); }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const source = await deps.open(taskId, sourcePath, password, progress);
      signal?.throwIfAborted();
      if (source?.taskId !== taskId || source.format !== 2) throw new AppError("backup/changed", "Unexpected source preparation receipt");
      const plan = await deps.plan(taskId, progress, signal);
      signal?.throwIfAborted();
      if (plan?.taskId !== taskId) throw new AppError("backup/changed", "Unexpected import planning receipt");
      const { taskId: _sourceId, ...sourceSummary } = source;
      const { taskId: _planId, ...planSummary } = plan;
      const read = (query: BackupReviewQuery, readSignal?: AbortSignal): Promise<BackupReviewPage> => {
        readSignal?.throwIfAborted();
        if (disposed) return Promise.reject(new AppError("backup/changed", "Backup review has been disposed"));
        if (pendingReads >= 32) return Promise.reject(new AppError("backup/busy", "Backup review queue is full"));
        const candidate = structuredClone(query);
        if (candidate.kind !== "rowField" && (!Number.isSafeInteger(candidate.limit) || candidate.limit < 1 || candidate.limit > 100)) {
          return Promise.reject(new AppError("backup/invalid-archive", "Invalid backup review page limit"));
        }
        pendingReads++;
        const operation = reads.then(async () => {
          readSignal?.throwIfAborted();
          if (disposed) throw new AppError("backup/changed", "Backup review has been disposed");
          const page = await deps.read(taskId, candidate);
          // A cancelled individual read leaves the native plan intact; do not
          // forward its signal to the whole-task cancellation command.
          readSignal?.throwIfAborted();
          if (disposed) throw new AppError("backup/changed", "Backup review has been disposed");
          if (page.kind !== candidate.kind) throw new AppError("backup/changed", "Unexpected backup review page");
          return page;
        }).finally(() => { pendingReads--; });
        reads = operation.then(() => {}, () => { /* The read caller owns its failure; later pages may continue. */ });
        return operation;
      };
      retained = true;
      return { source: sourceSummary, plan: planSummary, get disposed() { return disposed; }, read, dispose };
    } finally {
      // Cancellation before native admission can initially miss. Wait for
      // physical preparation/planning, then retry cleanup before returning.
      if (!retained) await dispose();
    }
  };
}
