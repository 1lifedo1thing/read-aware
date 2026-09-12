import { invoke } from "../../../platform/ipc";
import { withSyncBackup } from "../../../platform/sync/sync-scheduler";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";
import { withBackupCapture } from "./backup-capture";

/** Replay invalidates mounted stores just like a backup restore. Return the
 * committed decision, but keep existing write reservations until reload.
 * Failure releases them only after the native transaction has rolled back. */
export function applyProjectionRepair(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    void withSyncBackup(() => withPluginDataBackup("import", () => withBackupCapture(async () => {
      signal?.throwIfAborted();
      await invoke("rebuild_projections");
      resolve();
      return new Promise<never>(() => {});
    }, signal), signal), signal).catch(reject);
  });
}
