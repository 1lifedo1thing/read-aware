import { normalizeBookGraphTaskOptions, type BookGraphTaskOptions } from "./book-graph-task";
import { AppError } from "./errors";
import type { ReadingModeConfiguration } from "./reading-session";
import { normalizeBookTextPrepareOptions, type BookTextPrepareOptions } from "./book-text";

/** Semantic operation conditions, not a promise of remote success. More
 * operation kinds share this contract as their authoritative checks are wired. */
export type InferenceAvailabilityQuery = { operation: "llm.infer"; model?: "fast" | "smart"; images?: boolean };
export type ReadingOperationQuery = { bookId: string; sessionId?: string } & (
  | { operation: "reading.playback"; action: "start" | "stop" }
  | ({ operation: "reading.mode.configure" } & ReadingModeConfiguration)
);
export type BookTextAvailabilityQuery = { operation: "library.text.prepare"; bookId: string } & BookTextPrepareOptions;
export type GraphAvailabilityQuery = { operation: "memory.graph.generate"; bookId: string; mode: "catch-up" | "rebuild"; maxChapters?: number };
export type SyncAvailabilityQuery = { operation: "sync.now" };
export type OperationAvailabilityQuery = InferenceAvailabilityQuery | ReadingOperationQuery | BookTextAvailabilityQuery | GraphAvailabilityQuery | SyncAvailabilityQuery;
export type NormalizedOperationAvailabilityQuery = Required<InferenceAvailabilityQuery> | ReadingOperationQuery | Required<BookTextAvailabilityQuery> | (GraphAvailabilityQuery & BookGraphTaskOptions) | SyncAvailabilityQuery;
export type OperationConditionState = "satisfied" | "unconfigured" | "unavailable" | "unknown";
export type OperationCondition = {
  kind: "permission" | "account" | "model" | "endpoint" | "provider" | "input" | "object" | "reader" | "capacity";
  state: OperationConditionState;
  reason: string;
  errorCode?: string;
};
export type OperationAvailability = {
  operation: OperationAvailabilityQuery["operation"];
  model?: "fast" | "smart";
  state: "available" | Exclude<OperationConditionState, "satisfied">;
  conditions: OperationCondition[];
  /** This query never sends a probe or executes the operation. */
  remoteChecked: false;
};
export type OperationAvailabilityPort = { check(query: OperationAvailabilityQuery, signal?: AbortSignal): Promise<OperationAvailability> };

export function normalizeOperationAvailability(input: unknown): NormalizedOperationAvailabilityQuery {
  const invalid = () => new AppError("plugin/invalid-argument", "Invalid operation availability query");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const raw = input as Record<string, unknown>;
  if (raw.operation === "memory.graph.generate") {
    if (Object.keys(raw).some(key => !["operation", "bookId", "mode", "maxChapters"].includes(key))
      || typeof raw.bookId !== "string" || !raw.bookId.trim() || raw.bookId.length > 256
      || raw.mode !== "catch-up" && raw.mode !== "rebuild") throw invalid();
    return { operation: raw.operation, bookId: raw.bookId, mode: raw.mode,
      ...normalizeBookGraphTaskOptions(raw.maxChapters === undefined ? undefined : { maxChapters: raw.maxChapters }) };
  }
  if (raw.operation === "sync.now") {
    if (Object.keys(raw).some(key => key !== "operation")) throw invalid();
    return { operation: "sync.now" };
  }
  if (raw.operation === "library.text.prepare") {
    if (Object.keys(raw).some(key => !["operation", "bookId", "rebuild", "priority", "timeoutMs"].includes(key))
      || typeof raw.bookId !== "string" || !raw.bookId.trim() || raw.bookId.length > 256) throw invalid();
    const { operation, bookId, ...options } = raw;
    return { operation, bookId, ...normalizeBookTextPrepareOptions(options as BookTextPrepareOptions) };
  }
  if (raw.operation === "reading.playback" || raw.operation === "reading.mode.configure") {
    const fields = raw.operation === "reading.playback" ? ["action"] : ["active", "modeKey", "selectModeKey", "unitId"];
    if (Object.keys(raw).some(key => !["operation", "bookId", "sessionId", ...fields].includes(key))) throw invalid();
    for (const key of ["bookId", "sessionId", "modeKey", "selectModeKey", "unitId"]) {
      const value = raw[key];
      if ((key === "bookId" || value !== undefined) && (typeof value !== "string" || !value.trim() || value.length > 512)) throw invalid();
    }
    const target = { bookId: raw.bookId as string, ...(raw.sessionId === undefined ? {} : { sessionId: raw.sessionId as string }) };
    if (raw.operation === "reading.playback") {
      if (raw.action !== "start" && raw.action !== "stop") throw invalid();
      return { operation: raw.operation, ...target, action: raw.action };
    }
    if (typeof raw.active !== "boolean") throw invalid();
    return { operation: raw.operation, ...target, active: raw.active,
      ...(raw.modeKey === undefined ? {} : { modeKey: raw.modeKey as string }),
      ...(raw.selectModeKey === undefined ? {} : { selectModeKey: raw.selectModeKey as string }),
      ...(raw.unitId === undefined ? {} : { unitId: raw.unitId as string }) };
  }
  if (Object.keys(raw).some(key => !["operation", "model", "images"].includes(key))
    || raw.operation !== "llm.infer" || raw.model !== undefined && raw.model !== "fast" && raw.model !== "smart"
    || raw.images !== undefined && typeof raw.images !== "boolean") throw invalid();
  return { operation: "llm.infer", model: raw.model as "fast" | "smart" | undefined ?? "fast", images: raw.images as boolean | undefined ?? false };
}

export function operationAvailability(query: NormalizedOperationAvailabilityQuery, conditions: OperationCondition[]): OperationAvailability {
  const state = (["unavailable", "unconfigured", "unknown"] as const).find(state => conditions.some(condition => condition.state === state)) ?? "available";
  return { operation: query.operation, ...(query.operation === "llm.infer" ? { model: query.model } : {}), state, conditions, remoteChecked: false };
}

/** Unknown remote health is not a local refusal. Real execution retains its
 * own authorization, object validation, cancellation and provider errors. */
export function assertOperationAvailable(snapshot: OperationAvailability): void {
  assertOperationConditions(snapshot.conditions);
}

export function assertOperationConditions(conditions: readonly OperationCondition[]): void {
  const blocked = conditions.find(condition => condition.state === "unavailable" || condition.state === "unconfigured");
  if (blocked) throw new AppError(blocked.errorCode ?? "ui/unavailable", `Operation condition not met: ${blocked.kind}/${blocked.reason}`);
}
