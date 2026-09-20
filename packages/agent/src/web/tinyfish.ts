import { webImages } from "./images";
import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebClient, WebFetchInput, WebProvider, WebSearchInput } from "./types";

import { bounded, invalid, malformed, publicWebUrl, record, sourceUrl, string, jsonRequest } from "./shared";
export { publicWebUrl } from "./shared";

export function createTinyFishClient(apiKey: string, transport: AgentFetch): WebClient {
  const request = jsonRequest("TinyFish", apiKey, transport, { "X-API-Key": apiKey.trim() });
  return {
    async search(input: WebSearchInput, signal) {
      const query = input.query.trim();
      if (!query || query.length > 2000) throw invalid();
      const limit = bounded(input.limit, 5, 1, 10);
      const params = new URLSearchParams({ query });
      if (input.recencyDays !== undefined) params.set("recency_minutes", String(bounded(input.recencyDays, 1, 1, 3650) * 1440));
      if (input.language !== undefined) {
        if (!/^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(input.language)) throw invalid();
        params.set("language", input.language);
      }
      if (input.domains?.length) {
        if (input.domains.length > 5 || input.domains.some(d => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(d))) throw invalid();
        params.set("include_domains", input.domains.join(","));
      }
      const data = await request(`https://api.search.tinyfish.ai?${params}`, undefined, signal);
      if (!Array.isArray(data.results)) throw malformed();
      const sources = data.results.map(item => {
        const row = record(item);
        return { title: string(row.title, 300), url: sourceUrl(row.url), snippet: string(row.snippet, 800),
          ...(typeof row.date === "string" ? { publishedAt: row.date.slice(0, 80) } : {}) };
      }).filter(source => !input.domains?.length || input.domains.some(domain => {
        const host = new URL(source.url).hostname.toLowerCase();
        return host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`);
      })).slice(0, limit);
      return { provider: "tinyfish", query, sources, retrievedAt: new Date().toISOString(),
        ...(input.includeImages ? { images: [], warnings: ["TinyFish Search does not return images; use web_fetch with includeImages=true on a relevant source page."] } : {}) };
    },
    async fetch(input: WebFetchInput, signal) {
      const url = publicWebUrl(input.url);
      const offset = bounded(input.offset, 0, 0, 4_000_000);
      const maxChars = bounded(input.maxChars, 8000, 500, 12000);
      const data = await request("https://api.fetch.tinyfish.ai", {
        urls: [url], format: "markdown", ...(input.includeImages ? { image_links: true } : {}), ttl: input.fresh ? 0 : 3600, per_url_timeout_ms: 45000,
      }, signal);
      if (!Array.isArray(data.results) || (data.errors !== undefined && !Array.isArray(data.errors))) throw malformed();
      if (!data.results.length) {
        const failure = Array.isArray(data.errors) && data.errors.length ? record(data.errors[0]) : null;
        const code = failure?.error === "timeout" ? "timeout" : failure?.error === "content_too_large" ? "too-large" : "fetch-failed";
        throw new AppError(`search/${code}`, "TinyFish could not read this URL", { retryable: code === "timeout" });
      }
      const row = record(data.results[0]);
      if (typeof row.text !== "string" || !row.text.trim()) throw new AppError("search/fetch-failed", "Page contains no readable text");
      if (offset > row.text.length) throw invalid();
      const end = Math.min(offset + maxChars, row.text.length);
      return { provider: "tinyfish", url, finalUrl: sourceUrl(row.final_url ?? row.url ?? url), title: string(row.title, 300),
        text: row.text.slice(offset, end), offset, nextOffset: end < row.text.length ? end : null,
        ...(typeof row.published_date === "string" ? { publishedAt: row.published_date.slice(0, 80) } : {}),
        retrievedAt: new Date().toISOString(),
        ...(input.includeImages ? { images: webImages(row.image_links, row.final_url ?? row.url ?? url, row.title) } : {}) };
    },
  };
}

export const tinyFishProvider: WebProvider = {
  id: "tinyfish", label: "TinyFish", keyUrl: "https://agent.tinyfish.ai/api-keys", supportsFetch: true, create: createTinyFishClient,
};
