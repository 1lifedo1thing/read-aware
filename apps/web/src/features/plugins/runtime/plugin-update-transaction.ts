import { AppError, errorCode } from "@read-aware/core";

export type PluginUpdateTransaction<TCandidate> = {
  startCandidate(): Promise<TCandidate>;
  verifyCandidate(candidate: TCandidate): void | Promise<void>;
  commitFiles(): Promise<void>;
  verifyCommit(candidate: TCandidate): void | Promise<void>;
  /** Stop the old runtime before shared plugin data can change. */
  quiescePrevious(): void | Promise<void>;
  /** Take the rollback baseline only after the old runtime's writes are durable. */
  snapshotData(): void | Promise<void>;
  migrateCandidate(candidate: TCandidate): void | Promise<void>;
  /** Explicit side-effect boundary: candidate contributions become live here. */
  promoteCandidate(candidate: TCandidate): void | Promise<void>;
  /** Final durable decision; no fallible retirement step may follow it. */
  accept(candidate: TCandidate): void | Promise<void>;
  retirePrevious(): void | Promise<void>;
  cleanupCandidate(candidate: TCandidate | undefined): void | Promise<void>;
  rollbackFiles(): void | Promise<void>;
  restoreData(): void | Promise<void>;
  restartPrevious(): void | Promise<void>;
};

export class PluginUpdateError extends AppError {
  readonly cause: unknown;
  readonly recoveryErrors: Error[];

  constructor(cause: unknown, recoveryErrors: Error[]) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const recovery = recoveryErrors.length
      ? ` Recovery also failed: ${recoveryErrors.map((error) => error.message).join("; ")}`
      : "";
    super(errorCode(cause) ?? "plugin/error", message + recovery, { cause });
    this.name = "PluginUpdateError";
    this.cause = cause;
    this.recoveryErrors = recoveryErrors;
  }
}

/**
 * The update state machine, separated from Tauri/Worker details so its ordering
 * and failure guarantees stay executable as a contract.
 */
export async function runPluginUpdateTransaction<TCandidate>(
  transaction: PluginUpdateTransaction<TCandidate>,
): Promise<TCandidate> {
  let candidate: TCandidate | undefined;
  let committed = false;
  let quiescenceAttempted = false;
  let dataMayHaveChanged = false;
  try {
    candidate = await transaction.startCandidate();
    await transaction.verifyCandidate(candidate);
    quiescenceAttempted = true;
    await transaction.quiescePrevious();
    await transaction.snapshotData();
    await transaction.commitFiles();
    committed = true;
    await transaction.verifyCommit(candidate);
    dataMayHaveChanged = true;
    await transaction.migrateCandidate(candidate);
    await transaction.promoteCandidate(candidate);
    await transaction.retirePrevious();
    await transaction.accept(candidate);
    return candidate;
  } catch (cause) {
    const recoveryErrors: Error[] = [];
    const recover = async (step: () => void | Promise<void>): Promise<boolean> => {
      try {
        await step();
        return true;
      } catch (error) {
        recoveryErrors.push(error instanceof Error ? error : new Error(String(error)));
        return false;
      }
    };

    const stopped = await recover(() => transaction.cleanupCandidate(candidate));
    // Never restore underneath a candidate that may still write, or restart old
    // code against a failed file/data rollback. Leave it inert for honest recovery.
    if (stopped) {
      if (committed) await recover(transaction.rollbackFiles);
      if (dataMayHaveChanged) await recover(transaction.restoreData);
      if (quiescenceAttempted && recoveryErrors.length === 0) await recover(transaction.restartPrevious);
    }
    throw new PluginUpdateError(cause, recoveryErrors);
  }
}
