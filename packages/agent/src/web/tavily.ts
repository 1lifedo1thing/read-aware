import { webImages } from "./images";
import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebClient, WebProvider } from "./types";
import { fetchInput, fetchResult, jsonRequest, malformed, record, searchInput, searchResult, since, sourceUrl, string } from "./shared";

export function createTavilyClient(apiKey: string, transport: AgentFetch): WebClient {
  const request = jsonRequest("Tavily", apiKey, transport, { Authorization: `Bearer ${apiKey.trim()}` }, [432, 433]);
  return {
    async search(raw, signal) {
      const input = searchInput(raw);
      const data = await request("https://api.tavily.com/search", {
        query: input.query, max_results: input.limit, search_depth: "basic", topic: "general",
        ...(input.includeImages ? { include_images: true, include_image_descriptions: true } : {}),
        auto_parameters: false, include_answer: false, include_raw_content: false, include_published_date: true,
        ...(input.domains?.length ? { include_domains: input.domains } : {}),
        ...(input.recencyDays ? { start_date: since(input.recencyDays).slice(0, 10) } : {}),
        ...(input.language ? { language: input.language.toLowerCase() } : {}),
      }, signal);
      if (!Array.isArray(data.results)) throw malformed();
      const result = searchResult("tavily", input, data.results.map(item => {
        const row = record(item);
        return { title: string(row.title, 300), url: sourceUrl(row.url), snippet: string(row.content, 800),
          ...(typeof row.published_date === "string" ? { publishedAt: row.published_date.slice(0, 80) } : {}) };
      }));
      if (input.includeImages) result.images = data.results.flatMap(item => { const row = record(item); return result.sources.some(source => source.url === sourceUrl(row.url)) ? webImages(row.images, row.url, row.title) : []; }).slice(0, 8);
      return result;
    },
    async fetch(raw, signal) {
      const input = fetchInput(raw);
      const data = await request("https://api.tavily.com/extract", {
        urls: [input.url], ...(input.includeImages ? { include_images: true } : {}), extract_depth: "basic", format: "markdown", timeout: 45,
      }, signal);
      if (!Array.isArray(data.results) || (data.failed_results !== undefined && !Array.isArray(data.failed_results))) throw malformed();
      if (!data.results.length) throw new AppError("search/fetch-failed", "Tavily could not read this URL");
      const row = record(data.results[0]);
      return fetchResult("tavily", input, { url: row.url, title: row.title, text: row.raw_content,
        ...(input.includeImages ? { images: webImages(row.images, row.url, row.title) } : {}),
        // Extract exposes no cache bypass. Never promise freshness it cannot prove.
        ...(input.fresh ? { warnings: ["Tavily Extract does not expose a cache bypass; freshness is not guaranteed."] } : {}) });
    },
  };
}
export const tavilyProvider: WebProvider = {
  id: "tavily", label: "Tavily", keyUrl: "https://app.tavily.com/home", supportsFetch: true, create: createTavilyClient,
};
