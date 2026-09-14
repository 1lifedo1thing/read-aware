import { accountCredential, createModelResolver } from "@read-aware/agent";
import { errorCode, normalizeOperationAvailability, operationAvailability, type OperationAvailabilityQuery,
  type InferenceAvailabilityQuery, type OperationAvailability, type OperationCondition } from "@read-aware/core";
import { readingRuntime } from "../domain/reading-runtime";
import { getAIConfig, type AIConfig } from "../features/ai/lib/ai-config";
import { accountFromConfig } from "../features/ai/agent/account";
import { afterLocalKVWrites } from "../platform/local-store";
import { afterSecretWrites } from "../platform/secret-store";
import { createLogger } from "../platform/logger";

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

export async function checkOperationAvailability(input: OperationAvailabilityQuery, signal?: AbortSignal): Promise<OperationAvailability> {
  const query = normalizeOperationAvailability(input);
  signal?.throwIfAborted();
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
