import { AppError } from "@read-aware/core";

export type FullBackupProgress =
  | { phase: "preparing" }
  | { phase: "database"; remainingPages: number; totalPages: number }
  | { phase: "files"; copiedBytes: number }
  | { phase: "verifyingPrograms" }
  | { phase: "encrypting" };
export type FullBackupCaptureReceipt = { taskId: string; format: 2 };
type Dependencies = {
  id(): string;
  selectDestination(): Promise<string | null>;
  /** Includes source preparation and all write fences; resolves only after
   * physical capture and fence release. No password or destination here. */
  capture(taskId: string, progress: (update: FullBackupProgress) => void, signal?: AbortSignal): Promise<FullBackupCaptureReceipt>;
  write(taskId: string, password: string, destination: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  warn(message: string, error: unknown): void;
};

/** Host-only task. Actors receive neither passwords, file paths nor task IDs.
 * The native owner holds all plaintext and publishes encrypted output atomically. */
export function createFullBackupExport(deps: Dependencies) {
  return async (password: string, signal?: AbortSignal, onProgress?: (update: FullBackupProgress) => void): Promise<boolean> => {
    signal?.throwIfAborted();
    if ([...password].length < 12 || new TextEncoder().encode(password).length > 1024) {
      throw new AppError("backup/password-policy", "Invalid full backup passphrase length");
    }
    // Never keep a write fence across user input.
    const destination = await deps.selectDestination();
    signal?.throwIfAborted();
    if (destination === null) return false;
    const taskId = deps.id();
    let cancelling: Promise<void> | undefined;
    const cancel = (): Promise<void> => cancelling ??= Promise.resolve().then(() => deps.cancel(taskId))
      .catch(error => deps.warn("Full backup task cleanup failed", error))
      .finally(() => { cancelling = undefined; });
    const abort = () => { void cancel(); };
    const progress = (update: FullBackupProgress) => {
      // An abort IPC can arrive before native capture admission. Retry once
      // native progress proves admission; the final cleanup also retries.
      if (signal?.aborted) { abort(); return; }
      try { onProgress?.(update); }
      catch (error) { deps.warn("Full backup progress observer failed", error); }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const receipt = await deps.capture(taskId, progress, signal);
      signal?.throwIfAborted();
      if (receipt?.taskId !== taskId || receipt.format !== 2) {
        throw new AppError("backup/changed", "Unexpected full backup capture receipt");
      }
      progress({ phase: "encrypting" });
      signal?.throwIfAborted();
      await deps.write(taskId, password, destination);
      // A successful atomic publication remains success even if abort raced
      // with the native reply. Do not claim the saved file was rolled back.
      return true;
    } finally {
      signal?.removeEventListener("abort", abort);
      await cancelling;
      // Wait for physical capture/write before retiring a ready task. Also
      // covers a lost/invalid receipt or cancellation before native admission.
      await cancel();
    }
  };
}
