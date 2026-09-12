import { withDomainBackup, type RunDomainWrite } from "../../../platform/domain-write-gate";
import { pluginSchedules } from "../../plugins/runtime/plugin-scheduler";
import { withReadingBackup } from "../../reader/lib/reading-trace-runtime";

/** Final local window, inside sync/plugin preparation and exclusion. Close
 * reading facts before fencing domain commits; retain every outer reservation
 * until capture/restore and its owned native writes actually finish. */
export function withBackupCapture<T>(operation: (runOwned: RunDomainWrite) => Promise<T>, signal?: AbortSignal): Promise<T> {
  return pluginSchedules.withPersistencePaused(
    () => withReadingBackup(() => withDomainBackup(operation, signal), signal),
    signal,
  );
}
