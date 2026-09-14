import { accountCredential, createModelResolver } from "@read-aware/agent";
import { errorCode, normalizeOperationAvailability, operationAvailability, type OperationAvailabilityQuery,
  type InferenceAvailabilityQuery, type OperationAvailability, type OperationCondition } from "@read-aware/core";
import { readingRuntime } from "../domain/reading-runtime";
import { hostIOConditions } from "./host-io";
import { hostWindow } from "./window";
import { hostSync } from "./sync";
import { getAIConfig, type AIConfig } from "../features/ai/lib/ai-config";
import { accountFromConfig } from "../features/ai/agent/account";
import { afterLocalKVWrites } from "../platform/local-store";
import { afterSecretWrites } from "../platform/secret-store";
import { createLogger } from "../platform/logger";
import type { BookTextTaskOwner } from "../features/library/lib/book-text-tasks";

export type OperationAvailabilityContext = { graphTasks?: { capacityConditions(): OperationCondition[] }; textPreparation?: Pick<BookTextTaskOwner, "conditions"> };

const log = createLogger("operation-availability");
const condition = (kind: OperationCondition["kind"], state: OperationCondition["state"], reason: string, errorCode?: string): OperationCondition =>
  ({ kind, state, reason, ...(errorCode ? { errorCode } : {}) });

/** Shared with execution's account/model resolver. No remote calls, catalog
 * refresh, runtime construction, credential values or endpoint identifiers. */
export function inspectInferenceAvailability(input: InferenceAvailabilityQuery, config: AIConfig | null): OperationAvailability {
  const query = normalizeOperationAvailability(input);
  if (query.operation !== "llm.infer") throw new Error("Expected inference availability query");
  const conditions: OperationCondition[] = [condition("permission", "satisfied", "authorized")];
  if (!config) return operationAvailability(query, [...conditions, condition("account", "unconfigured", "connection-not-configured", "ai/not-configured")]);
  let mapped: ReturnType<typeof accountFromConfig>;
  try { mapped = accountFromConfig(config); }
  catch (error) {
    log.warn("Cannot resolve inference account", error);
    return operationAvailability(query, [...conditions, condition("endpoint", "unconfigured", "connection-route-invalid", "ai/not-configured")]);
  }
  conditions.push(accountCredential(mapped.account).trim()
    ? condition("account", "satisfied", "credential-configured")
    : condition("account", "unconfigured", "credential-missing", "ai/not-configured"));
  const model = mapped.models[query.model];
  // Use the same primary-model prerequisite as the product runtime.
  conditions.push(config.model.trim() && model.trim() ? condition("model", "satisfied", "model-selected")
    : condition("model", "unconfigured", "model-not-selected", "ai/not-configured"));
  if (!config.model.trim() || !model.trim()) return operationAvailability(query, [...conditions,
    condition("endpoint", "unknown", "model-selection-required"), condition("provider", "unknown", "remote-health-not-checked")]);
  let resolved: ReturnType<ReturnType<typeof createModelResolver>> | undefined;
  try {
    resolved = createModelResolver(mapped.account, mapped.models)(query.model);
    const url = new URL(resolved.baseUrl);
    conditions.push(["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? condition("endpoint", "satisfied", "endpoint-configured")
      : condition("endpoint", "unavailable", "endpoint-invalid", "ai/not-configured"));
  } catch (error) {
    // A local resolver failure is not evidence about remote provider health.
    log.warn("Cannot resolve inference prerequisites", error);
    conditions.push(condition("endpoint", "unavailable", "model-route-unresolved", "ai/not-configured"));
  }
  if (query.images && resolved) conditions.push(resolved.input.includes("image")
    ? condition("input", "satisfied", "image-input-supported")
    : condition("input", "unavailable", "image-input-unsupported", "ai/image-unsupported"));
  conditions.push(condition("provider", "unknown", "remote-health-not-checked"));
  return operationAvailability(query, conditions);
}

export async function checkOperationAvailability(input: OperationAvailabilityQuery, signal?: AbortSignal, context?: OperationAvailabilityContext): Promise<OperationAvailability> {
  const query = normalizeOperationAvailability(input);
  signal?.throwIfAborted();
  if (query.operation === "ui.commands.execute") {
    const { trustedHostCommands } = await import("./host-command-runtime");
    signal?.throwIfAborted(); return trustedHostCommands("agent").check(query.command, signal);
  }
  if (query.operation === "plugins.callService") {
    const { pluginServices } = await import("../features/plugins/runtime/plugin-services");
    signal?.throwIfAborted(); return pluginServices.inspectForAgent(query.serviceCall);
  }
  if (query.operation === "clipboard.writeText" || query.operation === "ui.openExternal" || query.operation === "ui.exportFile") {
    return operationAvailability(query, [{ kind: "permission", state: "satisfied", reason: "authorized" }, ...hostIOConditions(query)]);
  }
  if (query.operation === "window.control") {
    return operationAvailability(query, [{ kind: "permission", state: "satisfied", reason: "authorized" }, ...await hostWindow.conditions(query.request, signal)]);
  }
  if (query.operation === "maintenance.checkForUpdates") {
    const { softwareUpdater } = await import("../features/update/lib/software-update-runtime");
    signal?.throwIfAborted();
    return operationAvailability(query, [condition("permission", "satisfied", "authorized"), ...softwareUpdater.checkConditions()]);
  }
  if (query.operation === "sync.now") {
    try { return operationAvailability(query, [{ kind: "permission", state: "satisfied", reason: "authorized" }, ...await hostSync.conditions(signal)]); }
    catch (error) { signal?.throwIfAborted(); log.warn("Cannot read sync prerequisites", error);
      return operationAvailability(query, [condition("provider", "unknown", "sync-prerequisites-read-failed", errorCode(error) ?? "ipc/unknown")]); }
  }
  if (query.operation === "memory.graph.generate") {
    try {
      const capacity = context?.graphTasks?.capacityConditions() ?? [condition("capacity", "unknown", "graph-task-owner-unavailable")];
      if (capacity.some(item => item.state === "unavailable")) return operationAvailability(query, capacity);
      const { graphObjectConditions } = await import("../domain/book-graph-tasks");
      const objects = await graphObjectConditions(query.bookId, signal);
      const inference = await checkOperationAvailability({ operation: "llm.infer", model: "fast" }, signal);
      signal?.throwIfAborted();
      return operationAvailability(query, [...(context?.graphTasks?.capacityConditions() ?? capacity), ...objects, ...inference.conditions]);
    } catch (error) {
      signal?.throwIfAborted(); log.warn("Cannot read graph prerequisites", error);
      const missing = ["reader/book-not-found", "library/book-not-found"].includes(errorCode(error) ?? "");
      return operationAvailability(query, [condition("object", missing ? "unavailable" : "unknown", missing ? "book-not-found" : "graph-prerequisites-read-failed", errorCode(error) ?? "ipc/unknown")]);
    }
  }
  if (query.operation === "library.text.prepare") {
    const { operation: _operation, bookId, ...options } = query;
    try {
      const conditions = await context?.textPreparation?.conditions(bookId, options, signal);
      signal?.throwIfAborted();
      return operationAvailability(query, [{ kind: "permission", state: "satisfied", reason: "authorized" }, ...(conditions ?? [
        condition("capacity", "unknown", "text-task-owner-unavailable"),
      ])]);
    } catch (error) {
      signal?.throwIfAborted();
      log.warn("Cannot read text preparation prerequisites", error);
      const missing = errorCode(error) === "library/book-not-found";
      return operationAvailability(query, [condition("object", missing ? "unavailable" : "unknown", missing ? "book-not-found" : "text-prerequisites-read-failed", errorCode(error) ?? "ipc/unknown")]);
    }
  }
  if (query.operation !== "llm.infer") {
    try {
      const result = readingRuntime.operationAvailability(query);
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      log.warn("Cannot read reading prerequisites", error);
      return operationAvailability(query, [condition("reader", "unknown", "reader-prerequisites-read-failed", errorCode(error) ?? "ipc/unknown")]);
    }
  }
  // Read only settled preferences and credentials, with no legacy migration.
  const snapshot = await afterLocalKVWrites(() => afterSecretWrites(() => {
    signal?.throwIfAborted();
    return inspectInferenceAvailability(query, getAIConfig({ migrateLegacy: false, strict: true }));
  })).catch(error => {
    signal?.throwIfAborted();
    log.warn("Cannot read inference prerequisites", error);
    return operationAvailability(query, [condition("account", "unknown", "configuration-read-failed", errorCode(error) ?? "ipc/unknown")]);
  });
  signal?.throwIfAborted();
  return snapshot;
}
