import { normalizeScheduleControl, type PluginScheduleControl } from "./plugin-schedules";
import { normalizeHostSyncFlow, type HostSyncFlowRequest } from "./host-sync";
import { normalizeHostCommandRequest, type HostCommandRequest } from "./host-commands";
import { normalizePluginServiceCall, type PluginServiceCall } from "./plugin-services";
import { normalizeBookGraphTaskOptions, type BookGraphTaskOptions } from "./book-graph-task";
import { normalizeHostWindowRequest, type HostWindowRequest } from "./host-window";
import { normalizeClipboardText, normalizeExternalUrl, normalizeHostExportDescription, type HostExportDescription } from "./host-io";
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
export type WindowAvailabilityQuery = { operation: "window.control"; request: HostWindowRequest };
export type ExportAvailabilityQuery = { operation: "ui.exportFile" } & HostExportDescription;
export type HostIOAvailabilityQuery = ExportAvailabilityQuery | { operation: "clipboard.writeText"; text: string } | { operation: "ui.openExternal"; url: string };
export type SyncAvailabilityQuery = { operation: "sync.now" } | { operation: "sync.requestFlow"; flow: HostSyncFlowRequest };
export type ScheduleAvailabilityQuery = { operation: "schedules.control"; schedule: PluginScheduleControl };
export type ModelCatalogAvailabilityQuery = { operation: "settings.refreshModelCatalog"; provider: string };
export type UpdateAvailabilityQuery = { operation: "maintenance.checkForUpdates" } | { operation: "diagnostics.verifyProjections" };
export type HostFlowAvailabilityQuery =
  | { operation: "maintenance.requestBackup"; action: "import" | "export" }
  | { operation: "diagnostics.requestReport"; action: "export" | "send" }
  | { operation: "maintenance.requestConnectionTest" }
  | { operation: "diagnostics.requestProjectionRepair" };
export type PluginServiceAvailabilityQuery = { operation: "plugins.callService"; serviceCall: PluginServiceCall };
export type HostCommandAvailabilityQuery = { operation: "ui.commands.execute"; command: HostCommandRequest };
export type OperationAvailabilityQuery = ScheduleAvailabilityQuery | ModelCatalogAvailabilityQuery | HostFlowAvailabilityQuery | UpdateAvailabilityQuery | HostCommandAvailabilityQuery | PluginServiceAvailabilityQuery | InferenceAvailabilityQuery | ReadingOperationQuery | BookTextAvailabilityQuery | GraphAvailabilityQuery | SyncAvailabilityQuery | WindowAvailabilityQuery | HostIOAvailabilityQuery;
export type NormalizedOperationAvailabilityQuery = ScheduleAvailabilityQuery | ModelCatalogAvailabilityQuery | HostFlowAvailabilityQuery | UpdateAvailabilityQuery | HostCommandAvailabilityQuery | PluginServiceAvailabilityQuery | Required<InferenceAvailabilityQuery> | ReadingOperationQuery | Required<BookTextAvailabilityQuery> | (GraphAvailabilityQuery & BookGraphTaskOptions) | SyncAvailabilityQuery | WindowAvailabilityQuery | HostIOAvailabilityQuery;
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
  if (raw.operation === "schedules.control") {
    if (Object.keys(raw).some(key => key !== "operation" && key !== "schedule")) throw invalid();
    return { operation: raw.operation, schedule: normalizeScheduleControl(raw.schedule as PluginScheduleControl) };
  }
  if (raw.operation === "settings.refreshModelCatalog") {
    if (Object.keys(raw).some(key => key !== "operation" && key !== "provider")
      || typeof raw.provider !== "string" || !raw.provider.trim() || raw.provider.length > 128) throw invalid();
    return { operation: raw.operation, provider: raw.provider };
  }
  if (raw.operation === "maintenance.requestBackup" || raw.operation === "diagnostics.requestReport") {
    if (Object.keys(raw).some(key => key !== "operation" && key !== "action")) throw invalid();
    if (raw.operation === "maintenance.requestBackup" && (raw.action === "import" || raw.action === "export")) return { operation: raw.operation, action: raw.action };
    if (raw.operation === "diagnostics.requestReport" && (raw.action === "export" || raw.action === "send")) return { operation: raw.operation, action: raw.action };
    throw invalid();
  }
  if (raw.operation === "maintenance.requestConnectionTest" || raw.operation === "diagnostics.requestProjectionRepair") {
    if (Object.keys(raw).some(key => key !== "operation")) throw invalid();
    return { operation: raw.operation };
  }
  if (raw.operation === "sync.requestFlow") {
    if (Object.keys(raw).some(key => key !== "operation" && key !== "flow")) throw invalid();
    return { operation: raw.operation, flow: normalizeHostSyncFlow(raw.flow as HostSyncFlowRequest) };
  }
  if (raw.operation === "memory.graph.generate") {
    if (Object.keys(raw).some(key => !["operation", "bookId", "mode", "maxChapters"].includes(key))
      || typeof raw.bookId !== "string" || !raw.bookId.trim() || raw.bookId.length > 256
      || raw.mode !== "catch-up" && raw.mode !== "rebuild") throw invalid();
    return { operation: raw.operation, bookId: raw.bookId, mode: raw.mode,
      ...normalizeBookGraphTaskOptions(raw.maxChapters === undefined ? undefined : { maxChapters: raw.maxChapters }) };
  }
  if (raw.operation === "ui.commands.execute") {
    if (Object.keys(raw).some(key => key !== "operation" && key !== "command")) throw invalid();
    return { operation: raw.operation, command: normalizeHostCommandRequest(raw.command) };
  }
  if (raw.operation === "plugins.callService") {
    if (Object.keys(raw).some(key => key !== "operation" && key !== "serviceCall")) throw invalid();
    return { operation: raw.operation, serviceCall: normalizePluginServiceCall(raw.serviceCall) };
  }
  if (raw.operation === "ui.exportFile") {
    const { operation, ...description } = raw;
    return { operation, ...normalizeHostExportDescription(description as HostExportDescription) };
  }
  if (raw.operation === "clipboard.writeText" || raw.operation === "ui.openExternal") {
    const field = raw.operation === "clipboard.writeText" ? "text" : "url";
    if (Object.keys(raw).some(key => key !== "operation" && key !== field)) throw invalid();
    return raw.operation === "clipboard.writeText" ? { operation: raw.operation, text: normalizeClipboardText(raw.text) }
      : { operation: raw.operation, url: normalizeExternalUrl(raw.url) };
  }
  if (raw.operation === "window.control") {
    if (Object.keys(raw).some(key => !["operation", "request"].includes(key))) throw invalid();
    return { operation: raw.operation, request: normalizeHostWindowRequest(raw.request as HostWindowRequest) };
  }
  if (raw.operation === "sync.now" || raw.operation === "maintenance.checkForUpdates" || raw.operation === "diagnostics.verifyProjections") {
    if (Object.keys(raw).some(key => key !== "operation")) throw invalid();
    return { operation: raw.operation };
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
