import type { HostSyncFlowRequest, OperationCondition } from "@read-aware/core";
import type { SyncStatusSnapshot } from "../platform/sync/sync-scheduler";

/** Local account admission only; credentials and remote health are checked by the actual flow. */
export function syncFlowConditions(request: HostSyncFlowRequest, status: Pick<SyncStatusSnapshot, "accountConnected" | "backend" | "state">,
  busy: boolean, transports: readonly { ref: string }[], purchaseAllowed: boolean): OperationCondition[] {
  if (busy) return [{ kind: "capacity", state: "unavailable", reason: "sync-connection-busy", errorCode: "ui/unavailable" }];
  if (request.action === "connect") {
    if (status.accountConnected && (status.backend !== "relay" || status.state !== "unauthenticated" || request.transportRef))
      return [{ kind: "account", state: "unavailable", reason: "sync-disconnect-before-connect", errorCode: "ui/unavailable" }];
    if (request.transportRef && !transports.some(item => item.ref === request.transportRef))
      return [{ kind: "provider", state: "unavailable", reason: "sync-transport-unregistered", errorCode: "sync/transport-unavailable" }];
  } else if (!status.accountConnected || (request.action !== "disconnect" && status.backend !== "relay")) {
    return [{ kind: "account", state: "unavailable", reason: "sync-flow-account-unavailable", errorCode: "ui/unavailable" }];
  }
  if ((request.action === "upgrade" || request.action === "billing") && !purchaseAllowed)
    return [{ kind: "provider", state: "unavailable", reason: "sync-purchase-unavailable", errorCode: "ui/unavailable" }];
  return [{ kind: "account", state: "satisfied", reason: "sync-flow-account-ready" },
    { kind: "provider", state: "unknown", reason: "sync-flow-remote-not-checked" }];
}
