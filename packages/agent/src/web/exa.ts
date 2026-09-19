import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebClient, WebProvider } from "./types";
import { fetchInput, fetchResult, jsonRequest, malformed, record, searchInput, searchResult, since, sourceUrl, string } from "./shared";

export function createExaClient(apiKey: string, transport: AgentFetch): WebClient {
  const request = jsonRequest("Exa", apiKey, transport, { "x-api-key": apiKey.trim() });
  return {
    async search(raw, signal) {
      const input = searchInput(raw);
      const data = await request("https://api.exa.ai/search", {
        query: input.query, type: "auto", numResults: input.limit,
        contents: { highlights: true },
        ...(input.domains?.length ? { includeDomains: input.domains } : {}),
        ...(input.recencyDays ? { startPublishedDate: since(input.recencyDays) } : {}),
      }, signal);
      if (!Array.isArray(data.results)) throw malformed();
      return searchResult("exa", input, data.results.map(item => {
        const row = record(item);
        const highlights = Array.isArray(row.highlights) ? row.highlights.filter(x => typeof x === "string").join("\n") : "";
        return { title: string(row.title, 300), url: sourceUrl(row.url), snippet: string(highlights || row.text, 800),
          ...(typeof row.publishedDate === "string" ? { publishedAt: row.publishedDate.slice(0, 80) } : {}) };
      }), input.language ? ["Exa has no explicit language filter; results follow the query language."] : undefined);
    },
    async fetch(raw, signal) {
      const input = fetchInput(raw);
      const data = await request("https://api.exa.ai/contents", {
        urls: [input.url], text: true, maxAgeHours: input.fresh ? 0 : 1,
      }, signal);
      if (!Array.isArray(data.results)) throw malformed();
      if (!data.results.length) throw new AppError("search/fetch-failed", "Exa could not read this URL");
      const row = record(data.results[0]);
      return fetchResult("exa", input, { url: row.url, title: row.title, text: row.text, publishedAt: row.publishedDate });
    },
  };
}
export const exaProvider: WebProvider = {
  id: "exa", label: "Exa", keyUrl: "https://dashboard.exa.ai/api-keys", supportsFetch: true, create: createExaClient,
};
