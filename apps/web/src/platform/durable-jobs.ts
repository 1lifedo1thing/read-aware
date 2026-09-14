import { AppError, normalizeDurableJobPlan, type DurableJobPlan, type DurableJobStatus } from "@read-aware/core";
import { invoke } from "./ipc";
import { isTauri } from "./environment";
import { runDomainWrite } from "./domain-write-gate";
import { withPluginDataWrites } from "./plugin-data-access";
import type { DurableActorSource } from "./domain-actor";

/** Host-private checkpoint, including reconciliation handles. Never exposed as
 * plugin JSON: public snapshots contain only progress and stable error codes. */
export type DurableJobAttempt = {
  stepIndex: number; dispatchId: string; phase: "prepared" | "dispatching" | "unknown" | "settled";
  data: unknown;
};
export type DurableJobState = {
  source?: DurableActorSource;
  resumeRequested?: boolean;
  requestedAction?: "pause" | "cancel" | null;
  status: DurableJobStatus; nextStep: number; attempt: DurableJobAttempt | null;
  results: Array<{ stepId: string; receipt: unknown }>; errorCode: string | null;
};
export type DurableJobRecord = { owner: string; id: string; plan: DurableJobPlan; state: DurableJobState; revision: string; createdAt: string; updatedAt: string };
export interface DurableJobStore {
  create(id: string, plan: DurableJobPlan, assertAuthorized?: () => void | Promise<void>, source?: DurableActorSource): Promise<DurableJobRecord>;
  get(id: string): Promise<DurableJobRecord>;
  list(offset?: number, limit?: number): Promise<DurableJobRecord[]>;
  checkpoint(record: DurableJobRecord, state: DurableJobState): Promise<DurableJobRecord>;
}

export function nativeDurableJobStore(owner: string): DurableJobStore {
  const ready = () => { if (!isTauri()) throw new AppError("plugin/unavailable", "Durable jobs require desktop"); };
  const pluginId = owner.startsWith("plugin:") ? owner.slice(7) : undefined;
  const write = <T>(perform: () => Promise<T>) => {
    ready();
    return withPluginDataWrites(pluginId ? [pluginId] : [], () => runDomainWrite(perform));
  };
  return {
    create: (id, plan, assertAuthorized, source) => {
      const accepted = normalizeDurableJobPlan(plan);
      const savedSource = source ? structuredClone(source) : null;
      return write(async () => { await assertAuthorized?.(); return invoke("durable_job_create", { owner, id, plan: accepted, source: savedSource }); });
    },
    get: async id => {
      ready();
      const record = await invoke<DurableJobRecord | null>("durable_job_get", { owner, id });
      if (!record) throw new AppError("jobs/not-found", "Job not found for this owner");
      return record;
    },
    list: (offset = 0, limit = 20) => { ready(); return invoke("durable_job_list", { owner, offset, limit }); },
    checkpoint: (record, state) => {
      if (record.owner !== owner) throw new AppError("jobs/forbidden", "Checkpoint belongs to another owner");
      const accepted = structuredClone(state);
      return write(() => invoke("durable_job_checkpoint", { owner, id: record.id, expectedRevision: record.revision, state: accepted }));
    },
  };
}
