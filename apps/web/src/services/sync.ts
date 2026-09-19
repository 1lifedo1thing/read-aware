import { invoke } from "../platform/ipc";
import { AppError, type HostSyncFlowRequest, type WorkspaceSettingsSection } from "@read-aware/core";
import { classifySyncError } from "../platform/sync/classify-sync-error";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { getSyncConnectionBusy, getSyncConnectionOperationRevision, subscribeSyncConnectionBusy } from "../platform/sync/connection-operation";
import { getRemoteBlobFetchConditions, getSyncConnectionGeneration, getSyncStatusSnapshot, subscribeSyncStatus, syncNow, syncRelayClient } from "../platform/sync/sync-scheduler";
import { HostSyncService } from "./sync-controller";
import { SyncFlowController } from "./sync-flow-controller";
import { findSyncTransport, listSyncTransports } from "../platform/sync/transport-registry";
import { contributionText } from "../features/plugins/lib/plugin-i18n";
import { workspace } from "./workspace";

const log = createLogger("sync-service");
async function remote<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    log.warn("Sync service request failed", error);
    if (error instanceof AppError) throw new AppError(error.code, "Sync request failed", { retryable: error.retryable });
    throw new AppError(classifySyncError(error) ?? "sync/server", "Sync request failed");
  }
}
/**
 * Which settings section owns a sync flow's dialogs. Relay flows (sign-in,
 * account deletion, billing) live in Data & Sync; a plugin transport's connect
 * and disconnect live on that plugin's own settings page, so the flow
 * navigates there. A disconnect while the bound transport's plugin is gone
 * (disabled, uninstalled) has no plugin page — Data & Sync keeps that one.
 */
export function syncFlowSection(request?: HostSyncFlowRequest): WorkspaceSettingsSection {
  const status = getSyncStatusSnapshot();
  const ref = request?.action === "connect" ? request.transportRef ?? null
    : request?.action === "disconnect" && status.backend === "transport" ? status.transportRef : null;
  const transport = ref ? findSyncTransport(ref) : null;
  return transport ? `plugin:${transport.pluginId}` : "dataSync";
}
export const hostSyncFlows = new SyncFlowController((signal, origin, request) =>
  workspace.navigate({ surface: "settings", section: syncFlowSection(request) }, undefined, signal, false, undefined, origin), getSyncConnectionGeneration);
export const hostSync = new HostSyncService({
  supported: isTauri, busy: getSyncConnectionBusy,
  epoch: () => `${getSyncConnectionGeneration()}:${getSyncConnectionOperationRevision()}`,
  status: getSyncStatusSnapshot,
  subscribe: handler => {
    const status = subscribeSyncStatus(handler), busy = subscribeSyncConnectionBusy(handler);
    return () => { status(); busy(); };
  },
  backlog: async () => invoke<{ events: number; blobs: number }>("sync_outbox_counts"),
  account: () => remote(() => syncRelayClient().account()),
  run: origin => remote(() => syncNow(origin)),
  conditions: async () => (await getRemoteBlobFetchConditions()).map(value => ({ ...value,
    reason: value.reason === "source-download-not-checked" ? "sync-remote-health-not-checked" : value.reason,
    ...(value.errorCode ? { errorCode: "ui/unavailable" } : {}) })),
  openSettings: (signal, origin) => workspace.navigate({ surface: "settings", section: "dataSync" }, undefined, signal, false, undefined, origin),
  connectionOptions: async () => listSyncTransports().map(({ ref, label }) => ({ ref, label: contributionText(label) })),
  requestFlow: async (request, signal, origin) => {
    try { return await remote(() => hostSyncFlows.request(request, signal, origin)); }
    catch (error) { signal?.throwIfAborted(); throw error; }
  },
}, error => log.warn("Sync observer failed", error));
