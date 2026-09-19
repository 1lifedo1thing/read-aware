import { AppError } from "@read-aware/core";
import { WEB_PROVIDERS, type WebPort } from "@read-aware/agent";
import { appHttpFetch } from "../../../../platform/http-client";
import { createLogger } from "../../../../platform/logger";
import { fetchApiKey, fetchProviderId, getSearchConfig } from "../../lib/search-config";

const log = createLogger("web-retrieval");
function client(operation: "search" | "fetch") {
  const config = getSearchConfig();
  const key = operation === "fetch" ? fetchApiKey(config) : config.apiKey;
  const provider = operation === "fetch" ? fetchProviderId(config) : config.provider;
  if (!config.enabled || !key) throw new AppError("search/not-configured", "Enable Search and set its key in Settings → AI");
  return WEB_PROVIDERS[provider].create(key, appHttpFetch);
}
export const agentWeb: WebPort = {
  configured: (operation = "search") => { const config = getSearchConfig(); return config.enabled && Boolean(operation === "fetch" ? fetchApiKey(config) : config.apiKey); },
  search: async (input, signal) => {
    try { return await client("search").search(input, signal); }
    catch (error) { log.error("Web search failed", error); throw error; }
  },
  fetch: async (input, signal) => {
    try {
      const fetch = client("fetch").fetch;
      if (!fetch) throw new AppError("search/not-configured", "Configure a page reading provider in Settings → AI");
      return await fetch(input, signal);
    }
    catch (error) { log.error("Web fetch failed", error); throw error; }
  },
};
