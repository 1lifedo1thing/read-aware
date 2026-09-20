import { AppError } from "@read-aware/core";
import { WEB_PROVIDERS, type WebPort } from "@read-aware/agent";
import { appHttpFetch } from "../../../../platform/http-client";
import { createLogger } from "../../../../platform/logger";
import { getSearchConfig } from "../../lib/search-config";

const log = createLogger("web-retrieval");
function client() {
  const config = getSearchConfig();
  if (!config.enabled || !config.apiKey) throw new AppError("search/not-configured", "Enable Search and set its key in Settings → AI");
  return WEB_PROVIDERS[config.provider].create(config.apiKey, appHttpFetch);
}
export const agentWeb: WebPort = {
  configured: (operation = "search") => {
    const config = getSearchConfig();
    return config.enabled && Boolean(config.apiKey) && (operation === "search" || WEB_PROVIDERS[config.provider].supportsFetch);
  },
  search: async (input, signal) => {
    try { return await client().search(input, signal); }
    catch (error) { log.error("Web search failed", error); throw error; }
  },
  fetch: async (input, signal) => {
    try {
      const fetch = client().fetch;
      if (!fetch) throw new AppError("search/fetch-failed", "The selected provider does not support page reading");
      return await fetch(input, signal);
    }
    catch (error) { log.error("Web fetch failed", error); throw error; }
  },
};
