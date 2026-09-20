import { AppError } from "@read-aware/core";
import { isWebProviderId, type WebProviderId } from "@read-aware/agent";
import { localKV } from "../../../platform/local-store";
import { deleteSecret, getSecret, setSecret, type SecretKey } from "../../../platform/secret-store";
import { createLogger } from "../../../platform/logger";
import { causalActor } from "../../../platform/domain-actor";

export const SEARCH_CONFIG_KEY = "read-aware-search-config";
export interface SearchConfig {
  enabled: boolean; provider: WebProviderId; apiKey: string;
}
const log = createLogger("search-config");
// AI tool credentials share the audited encrypted backup/roaming family,
// but use a separate namespace from model provider keys.
const keySlot = (provider: WebProviderId): SecretKey => `ai-api-key.search.${provider}`;
export const getSearchApiKey = (provider: WebProviderId) => getSecret(keySlot(provider));

export function getSearchConfig(onReadError?: (error: AppError) => void): SearchConfig {
  const raw = localKV.getItem(SEARCH_CONFIG_KEY);
  let enabled = false; let provider: WebProviderId = "tinyfish";
  if (raw) {
    try {
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object" || !("provider" in data) || !isWebProviderId(data.provider)
        || !("enabled" in data) || typeof data.enabled !== "boolean") throw new AppError("search/not-configured", "Invalid search configuration");
      provider = data.provider; enabled = data.enabled;
      // Ignore the retired fetchProvider field. Both operations now belong to
      // the selected provider; never reactivate an old cross-provider fallback.
    } catch (error) {
      log.error("Could not read search configuration; retrieval disabled", error);
      onReadError?.(new AppError("search/not-configured", "Stored search configuration is invalid"));
      enabled = false; provider = "tinyfish";
    }
  }
  return { enabled, provider, apiKey: getSearchApiKey(provider) };
}

/** Same write-through/rollback seam as model settings; no key enters ordinary KV. */
export function saveSearchConfig(config: SearchConfig): void {
  if (!isWebProviderId(config.provider)) throw new AppError("search/not-configured", "Unknown search provider");
  const apiKey = config.apiKey.trim();
  const actor = causalActor("user");
  if (apiKey !== getSearchApiKey(config.provider)) {
    if (apiKey) setSecret(keySlot(config.provider), apiKey, "local", actor);
    else deleteSecret(keySlot(config.provider), "local", actor);
  }
  localKV.setItem(SEARCH_CONFIG_KEY, JSON.stringify({ enabled: config.enabled, provider: config.provider }), "local", actor);
}
