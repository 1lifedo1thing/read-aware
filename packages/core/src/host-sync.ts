import { AppError } from "./errors";
import type { SyncTier, SyncTierLimits } from "./sync";

export type HostSyncSnapshot = {
  revision: number;
  supported: boolean;
  connectionBusy: boolean;
  state: "disabled" | "idle" | "syncing" | "error" | "unauthenticated";
  connected: boolean;
  backend: "relay" | "transport" | null;
  lastSyncAt: number | null;
  lastErrorCode: string | null;
  progress: {
    phase: "bootstrap" | "pull" | "verify" | "push" | "blobs" | "backfill" | "checkpoint";
    pulled: number;
    pushed: number;
    verified: number;
    backfilled: number;
    blobsDone: number;
    blobsTotal: number;
  } | null;
  cycleStartBacklog: { events: number; blobs: number } | null;
  lastCycle: { pulled: number; pushed: number; blobs: number; backfilled: number } | null;
  backfillRemaining: number;
};
export type HostSyncAccount = {
  tier: SyncTier;
  hasBilling: boolean;
  blobBytesUsed: number;
  eventsUsed: number;
  aiCreditsUsed: number;
  limits: SyncTierLimits;
};
export type HostSyncReceipt = { status: "completed" | "already-running"; snapshot: HostSyncSnapshot };
export type HostSyncFlow = "connect" | "disconnect" | "delete-account" | "upgrade" | "billing";
export type HostSyncFlowRequest = { action: HostSyncFlow; transportRef?: string };
export type HostSyncFlowReceipt = {
  action: HostSyncFlow;
  /** External handoff is not proof of purchase or a billing change. */
  status: "completed" | "cancelled" | "external-opened";
};
export type HostSyncPort = {
  /** Current sync state: backend, connection, progress, last cycle and last error code. */
  snapshot(): Promise<HostSyncSnapshot>;
  backlog(signal?: AbortSignal): Promise<{ events: number; blobs: number }>;
  /** Explicit remote read. No email, account ID, keys, session or billing ticket. */
  account(signal?: AbortSignal): Promise<HostSyncAccount | null>;
  /**
   * Runs one sync round on the configured backend — the relay or a plugin
   * transport such as WebDAV, including transports that only sync on request —
   * and resolves when that round has finished: `completed`, or
   * `already-running` when a round was in progress (it is not queued again).
   * Rejects with a coded `AppError` when no round can start (`ui/unavailable`
   * while sync is unsupported, disconnected, disabled or busy) and with the
   * round's error when it fails — classified failures carry a `sync/*` code
   * such as `sync/network` or `sync/unauthorized`. Caller cancellation cannot
   * stop a shared sync or undo its writes.
   */
  requestSync(signal?: AbortSignal): Promise<HostSyncReceipt>;
  /** Opens the host Data & Sync page, not an automatic login, disconnect or purchase. */
  openSettings(signal?: AbortSignal): Promise<{ status: "opened"; surface: "dataSync" }>;
  /** Registered backend references and display labels, never endpoint credentials. */
  connectionOptions(): Promise<{ ref: string; label: string }[]>;
  /** Host-owned identity/passphrase and destructive confirmation. Waits for the
   * final local outcome or external handoff. Cancellation cannot undo a started operation. */
  requestFlow(request: HostSyncFlowRequest, signal?: AbortSignal): Promise<HostSyncFlowReceipt>;
};

export function normalizeHostSyncFlow(input: HostSyncFlowRequest): HostSyncFlowRequest {
  if (
    !input ||
    !["connect", "disconnect", "delete-account", "upgrade", "billing"].includes(input.action) ||
    Object.keys(input).some((key) => key !== "action" && key !== "transportRef") ||
    (input.transportRef !== undefined &&
      (input.action !== "connect" ||
        typeof input.transportRef !== "string" ||
        !input.transportRef.length ||
        input.transportRef.length > 256))
  ) {
    throw new AppError("ui/invalid-target", "Invalid sync flow");
  }
  return { action: input.action, ...(input.transportRef !== undefined ? { transportRef: input.transportRef } : {}) };
}
