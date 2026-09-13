import { AppError, ERR_DATA_WIPE_INCOMPLETE, errorCode } from "@read-aware/core";
import { invoke } from "../../../platform/ipc";
import { isTauri } from "../../../platform/environment";
import { syncRelayClient, withSyncBackup } from "../../../platform/sync/sync-scheduler";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";
import { clearWebviewStorage } from "../../../platform/clear-webview-storage";
import { withBackupCapture } from "./backup-capture";

type WipeState = null | { phase: "working" } | { phase: "reload-required"; error?: unknown };
let state: WipeState = null;
const listeners = new Set<() => void>();
export const getDataWipeState = () => state;
export const subscribeDataWipe = (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
function publish(next: WipeState) { state = next; for (const listener of listeners) listener(); }

/** Wipe this device, not the relay account. Drain existing writes and retain
 * their barriers once native records have been cleared, including partial file
 * cleanup failure. The native transaction owns anti-import/recovery markers;
 * boot completes a pending wipe before it hydrates any old WebView data. */
export async function deleteAllData(): Promise<void> {
  if (!isTauri()) throw new AppError("ui/unavailable", "Deleting all data requires desktop");
  if (state) throw new AppError("backup/busy", "Local data deletion is already active");
  publish({ phase: "working" });
  try { await syncRelayClient().logout(); }
  catch { /* Offline or never connected: local deletion must still proceed. */ }

  return new Promise((resolve, reject) => {
    void withSyncBackup(() => withPluginDataBackup("import", () => withBackupCapture(async () => {
      let failure: unknown;
      try { await invoke("wipe_all_data"); }
      catch (error) {
        if (errorCode(error) !== ERR_DATA_WIPE_INCOMPLETE) throw error;
        failure = error;
      }
      await clearWebviewStorage();
      if (!failure) {
        try { await invoke("delete_kv", { key: "read-aware-wipe-webview-pending" }); }
        catch (error) { failure = new AppError(ERR_DATA_WIPE_INCOMPLETE, "WebView cleanup acknowledgement failed", { cause: error }); }
      }
      publish({ phase: "reload-required", ...(failure ? { error: failure } : {}) });
      if (failure) reject(failure); else resolve();
      // SQLite and JS mirrors now differ. Even a cancelled/unmounted settings
      // page must not release sync, plugin, reading or domain write admission.
      return new Promise<never>(() => {});
    }))).catch(error => { publish(null); reject(error); });
  });
}
