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
  configured: () => { const config = getSearchConfig(); return config.enabled && Boolean(config.apiKey); },
  search: async (input, signal) => {
    try { return await client().search(input, signal); }
    catch (error) { log.error("Web search failed", error); throw error; }
  },
  fetch: async (input, signal) => {
    try { return await client().fetch(input, signal); }
    catch (error) { log.error("Web fetch failed", error); throw error; }
  },
};
