import { AppError } from "./errors";

export type PluginScheduleOutcome = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type PluginDeferredRequest = { requestId: string; delayMs: number; when: "any" | "idle" };
export type PluginDeferredState = PluginDeferredRequest & { ownerVersion: string; dueAt: number; state: "queued" | PluginScheduleOutcome; errorCode: string | null };
export type PluginScheduleRun = { trigger: "periodic" | "manual" | "deferred"; requestId: string | null; startedAt: number };
export type PluginDeferredReceipt = { status: "queued" | "retained" | "cancelled" | "not-queued"; request: PluginDeferredState | null };
export function normalizeDeferredRequest(input: PluginDeferredRequest): PluginDeferredRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["requestId", "delayMs", "when"].includes(key))
    || typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId)
    || !Number.isSafeInteger(input.delayMs) || input.delayMs < 1000 || input.delayMs > 604_800_000
    || !["any", "idle"].includes(input.when)) throw new AppError("ui/invalid-target", "Invalid deferred schedule request");
  return { requestId: input.requestId, delayMs: input.delayMs, when: input.when };
}
export type PluginScheduleState = {
  pluginId: string; id: string; label: string; everyMinutes: number | null;
  /** The most recent one-shot request only, not an execution-history archive. */
  deferred?: PluginDeferredState | null;
  paused: boolean; running: boolean; lastStartedAt: number | null;
  lastFinishedAt: number | null; lastSuccessAt: number | null;
  lastOutcome: PluginScheduleOutcome | null; lastErrorCode: string | null;
};
export type PluginSchedulePage = { schedules: PluginScheduleState[]; total: number; nextOffset: number | null };
export type PluginScheduleQuery = { pluginId?: string; offset?: number; limit?: number };
export type PluginScheduleControl = { pluginId: string; id: string; action: "pause" | "resume" | "run" };
export type PluginScheduleReceipt = { status: "completed" | "already-running"; schedule: PluginScheduleState };
