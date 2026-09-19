import { AppError } from "@read-aware/core";
import { WEB_PROVIDERS, isWebProviderId, type WebProviderId } from "@read-aware/agent";
import { localKV } from "../../../platform/local-store";
import { deleteSecret, getSecret, setSecret, type SecretKey } from "../../../platform/secret-store";
import { createLogger } from "../../../platform/logger";
import { causalActor } from "../../../platform/domain-actor";

export const SEARCH_CONFIG_KEY = "read-aware-search-config";
export interface SearchConfig {
  enabled: boolean; provider: WebProviderId; apiKey: string;
  /** Used only when the search provider has no page-reading API. */
  fetchProvider?: WebProviderId; fetchApiKey?: string;
}
export const fetchProviderId = (config: SearchConfig): WebProviderId =>
  WEB_PROVIDERS[config.provider].supportsFetch ? config.provider : config.fetchProvider ?? "tinyfish";
export const fetchApiKey = (config: SearchConfig): string =>
  fetchProviderId(config) === config.provider ? config.apiKey : config.fetchApiKey ?? getSearchApiKey(fetchProviderId(config));
const log = createLogger("search-config");
// AI tool credentials share the audited encrypted backup/roaming family,
// but use a separate namespace from model provider keys.
const keySlot = (provider: WebProviderId): SecretKey => `ai-api-key.search.${provider}`;
export const getSearchApiKey = (provider: WebProviderId) => getSecret(keySlot(provider));

export function getSearchConfig(onReadError?: (error: AppError) => void): SearchConfig {
  const raw = localKV.getItem(SEARCH_CONFIG_KEY);
  let enabled = false; let provider: WebProviderId = "tinyfish";
  let fetchProvider: WebProviderId | undefined;
  if (raw) {
    try {
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object" || !("provider" in data) || !isWebProviderId(data.provider)
        || !("enabled" in data) || typeof data.enabled !== "boolean") throw new AppError("search/not-configured", "Invalid search configuration");
      provider = data.provider; enabled = data.enabled;
      if ("fetchProvider" in data) {
        if (!isWebProviderId(data.fetchProvider) || !WEB_PROVIDERS[data.fetchProvider].supportsFetch) throw new AppError("search/not-configured", "Invalid page reading provider");
        fetchProvider = data.fetchProvider;
      }
    } catch (error) {
      log.error("Could not read search configuration; retrieval disabled", error);
      onReadError?.(new AppError("search/not-configured", "Stored search configuration is invalid"));
      enabled = false; provider = "tinyfish"; fetchProvider = undefined;
    }
  }
  return { enabled, provider, apiKey: getSearchApiKey(provider),
    ...(fetchProvider ? { fetchProvider, fetchApiKey: getSearchApiKey(fetchProvider) } : {}) };
}

/** Same write-through/rollback seam as model settings; no key enters ordinary KV. */
export function saveSearchConfig(config: SearchConfig): void {
  if (!isWebProviderId(config.provider)) throw new AppError("search/not-configured", "Unknown search provider");
  if (config.fetchProvider && (!isWebProviderId(config.fetchProvider) || !WEB_PROVIDERS[config.fetchProvider].supportsFetch)) {
    throw new AppError("search/not-configured", "Invalid page reading provider");
  }
  const apiKey = config.apiKey.trim();
  const actor = causalActor("user");
  if (apiKey !== getSearchApiKey(config.provider)) {
    if (apiKey) setSecret(keySlot(config.provider), apiKey, "local", actor);
    else deleteSecret(keySlot(config.provider), "local", actor);
  }
  if (!WEB_PROVIDERS[config.provider].supportsFetch && config.fetchProvider && config.fetchApiKey !== undefined) {
    const key = config.fetchApiKey.trim();
    if (key !== getSearchApiKey(config.fetchProvider)) {
      if (key) setSecret(keySlot(config.fetchProvider), key, "local", actor);
      else deleteSecret(keySlot(config.fetchProvider), "local", actor);
    }
  }
  localKV.setItem(SEARCH_CONFIG_KEY, JSON.stringify({ enabled: config.enabled, provider: config.provider,
    ...(config.fetchProvider ? { fetchProvider: config.fetchProvider } : {}) }), "local", actor);
}
