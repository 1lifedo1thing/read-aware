import { AppError } from "@read-aware/core";
import { WEB_PROVIDERS, type WebPort, type WebClient, type WebProviderId } from "@read-aware/agent";
import { appHttpFetch } from "../../../../platform/http-client";
import { createLogger } from "../../../../platform/logger";
import { getSearchConfig } from "../../lib/search-config";
import { createCachedWebClient } from "../../lib/web-response-cache";
import { prefetchWebImages } from "../../lib/web-image-cache";

const log = createLogger("web-retrieval");
let cached: { provider: WebProviderId; key: string; client: Pick<WebClient, "search"> & Partial<Pick<WebClient, "fetch">> } | undefined;
function client() {
  const config = getSearchConfig();
  if (!config.enabled || !config.apiKey) { cached = undefined; throw new AppError("search/not-configured", "Enable Search and set its key in Settings → AI"); }
  if (cached?.provider === config.provider && cached.key === config.apiKey) return cached.client;
  // Cache lifetime is scoped to this provider and credential; neither is written to disk.
  const value = createCachedWebClient(WEB_PROVIDERS[config.provider], config.apiKey, appHttpFetch);
  cached = { provider: config.provider, key: config.apiKey, client: value };
  return value;
}
export const agentWeb: WebPort = {
  configured: (operation = "search") => {
    const config = getSearchConfig();
    return config.enabled && Boolean(config.apiKey) && (operation === "search" || WEB_PROVIDERS[config.provider].supportsFetch);
  },
  search: async (input, signal) => {
    const start = performance.now();
    try {
      const result = await client().search(input, signal);
      prefetchWebImages(result.images, signal);
      log.info("Search ready", { provider: result.provider, durationMs: Math.round(performance.now() - start), images: result.images?.length ?? 0 });
      return result;
    }
    catch (error) { log.error("Web search failed", error); throw error; }
  },
  fetch: async (input, signal) => {
    const start = performance.now();
    try {
      const fetch = client().fetch;
      if (!fetch) throw new AppError("search/fetch-failed", "The selected provider does not support page reading");
      const result = await fetch(input, signal);
      prefetchWebImages(result.images, signal);
      log.info("Page ready", { provider: result.provider, durationMs: Math.round(performance.now() - start), images: result.images?.length ?? 0 });
      return result;
    }
    catch (error) { log.error("Web fetch failed", error); throw error; }
  },
};
