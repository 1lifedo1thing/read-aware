import type { DomainActor } from "../platform/domain-actor";
import { normalizeHostSyncFlow, type HostSyncFlowRequest } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";

export class SyncFlowController extends HostActionFlow<HostSyncFlowRequest, "completed" | "external-opened"> {
  constructor(navigate: (signal?: AbortSignal, origin?: DomainActor, request?: HostSyncFlowRequest) => Promise<unknown>, epoch: () => number = () => 0) {
    super({ navigate, epoch,
      normalize: normalizeHostSyncFlow,
      completion: action => action === "upgrade" || action === "billing" ? "external-opened" : "completed",
    });
  }
}
