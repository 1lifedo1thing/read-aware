import { AppError } from "@read-aware/core";
import { validBackupPassword } from "./backup-password";

export type FullBackupImportProgress = "decrypting" | "checkingSource" | "comparingEvents" | "comparingRows" | "comparingFiles";
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
  cancel(taskId: string): Promise<void>;
  warn(message: string, error: unknown): void;
};
export type FullBackupReview = {
  readonly source: BackupSourceSummary;
  readonly plan: BackupPlanSummary;
  readonly disposed: boolean;
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
    const cancel = (): Promise<void> => cancelling ??= Promise.resolve().then(() => deps.cancel(taskId))
      .catch(error => deps.warn("Full backup import cleanup failed", error))
      .finally(() => { cancelling = undefined; });
    const dispose = (): Promise<void> => disposal ??= (async () => {
      disposed = true; signal?.removeEventListener("abort", abort);
      await cancelling; await cancel();
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
      retained = true;
      return { source: sourceSummary, plan: planSummary, get disposed() { return disposed; }, dispose };
    } finally {
      // Cancellation before native admission can initially miss. Wait for
      // physical preparation/planning, then retry cleanup before returning.
      if (!retained) await dispose();
    }
  };
}
