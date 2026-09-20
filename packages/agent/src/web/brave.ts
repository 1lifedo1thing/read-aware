import { webImages } from "./images";
import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebClient, WebProvider } from "./types";
import { optionalImages } from "./optional-images";
import { domainQuery, fetchInput, fetchResult, invalid, jsonRequest, malformed, record, searchInput, searchResult, since, sourceUrl, string } from "./shared";

function language(value: string) {
  const lower = value.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-hans") return "zh-hans";
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-hant") return "zh-hant";
  if (lower === "pt-br") return "pt-br";
  return lower.split("-")[0]!;
}
export function createBraveClient(apiKey: string, transport: AgentFetch): WebClient {
  const request = jsonRequest("Brave", apiKey, transport, { "X-Subscription-Token": apiKey.trim() });
  return { async search(raw, signal) {
    const input = searchInput(raw);
    const query = domainQuery(input);
    // Brave's request limit includes the added site operators; never truncate a query.
    if (query.length > 600 || query.split(/\s+/).length > 75) throw invalid();
    const params = new URLSearchParams({ q: query, count: String(input.limit), extra_snippets: "true" });
    if (input.recencyDays) params.set("freshness", `${since(input.recencyDays).slice(0, 10)}to${new Date().toISOString().slice(0, 10)}`);
    if (input.language) params.set("search_lang", language(input.language));
    const imageController = new AbortController();
    const imageSignal = signal ? AbortSignal.any([signal, imageController.signal]) : imageController.signal;
    const imageQueryValid = query.length <= 400 && query.split(/\s+/).length <= 50;
    // Native image search runs alongside web search, using the same BYOK key.
    // Keep source-page attribution and the provider's cached thumbnail separate
    // from the original asset. Image access failure must not lose text results.
    const imageRead = input.includeImages && imageQueryValid && input.recencyDays === undefined ? optionalImages(async signal => {
      const imageParams = new URLSearchParams({ q: query, count: "8", safesearch: "strict" });
      if (input.language) imageParams.set("search_lang", language(input.language));
      const data = await request(`https://api.search.brave.com/res/v1/images/search?${imageParams}`, undefined, signal);
      if (data.type !== "images" || !Array.isArray(data.results) || data.error !== undefined) throw malformed();
      return data.results.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        let url: string;
        try { url = sourceUrl(row.url); } catch { return []; }
        const host = new URL(url).hostname;
        if (input.domains?.length && !input.domains.some(domain => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`))) return [];
        const thumbnail = row.thumbnail && typeof row.thumbnail === "object" ? row.thumbnail as Record<string, unknown> : {};
        const properties = row.properties && typeof row.properties === "object" ? row.properties as Record<string, unknown> : {};
        const images = webImages([{ url: properties.url, thumbnailUrl: thumbnail.src, description: row.title }], url, row.title);
        return images.length ? images : webImages([{ url: thumbnail.src, description: row.title }], url, row.title);
      }).slice(0, 8);
    }, imageSignal).catch(() => undefined) : Promise.resolve(undefined);
    try {
      const data = await request(`https://api.search.brave.com/res/v1/web/search?${params}`, undefined, signal);
      if (data.type !== "search" || data.error !== undefined) throw malformed();
      // Brave legitimately omits the web object for an empty web result set.
      const rows = data.web === undefined ? [] : record(data.web).results;
      if (!Array.isArray(rows)) throw malformed();
      const result = searchResult("brave", input, rows.map(item => {
        const row = record(item);
        const extras = Array.isArray(row.extra_snippets) ? row.extra_snippets.filter(x => typeof x === "string") : [];
        return { title: string(row.title, 300), url: sourceUrl(row.url),
          snippet: string([string(row.description, 800), ...extras].filter(Boolean).join("\n"), 800),
          ...(typeof row.page_age === "string" ? { publishedAt: row.page_age.slice(0, 80) } : {}) };
      }));
      if (input.includeImages) {
        const nativeImages = await imageRead;
        signal?.throwIfAborted();
        result.images = nativeImages ?? rows.flatMap(item => { const row = record(item); const thumbnail = row.thumbnail && typeof row.thumbnail === "object" ? row.thumbnail as Record<string, unknown> : {};
          return result.sources.some(source => source.url === sourceUrl(row.url)) ? webImages([thumbnail.src], row.url, row.title) : []; }).slice(0, 8);
        if (!nativeImages) result.warnings = [input.recencyDays !== undefined
          ? "Brave image search cannot apply the requested date filter; any candidates below are thumbnails from the date-filtered web results, not date-verified images."
          : imageQueryValid
          ? "Brave image search was unavailable or exceeded its time budget; any candidates below are web-result thumbnails."
          : "The query exceeds Brave image search limits; any candidates below are web-result thumbnails."];
      }
      return result;
    } finally { imageController.abort(); }
  }, async fetch(raw, signal) {
    const input = fetchInput(raw);
    if (input.url.length > 600) throw invalid();
    // Brave has query-based extraction, not an arbitrary-URL crawler. Keep only
    // the exact requested source; a related page must never stand in for it.
    const data = await request("https://api.search.brave.com/res/v1/llm/context", {
      q: input.url, count: 5, maximum_number_of_urls: 5,
      maximum_number_of_tokens: 8192, maximum_number_of_tokens_per_url: 8192,
      context_threshold_mode: "disabled", enable_local: false,
      ...(input.includeImages ? { enable_source_metadata: true } : {}),
    }, signal);
    const rows = record(data.grounding).generic;
    if (!Array.isArray(rows) || data.error !== undefined) throw malformed();
    const page = rows.map(record).find(row => sourceUrl(row.url) === input.url);
    if (!page) throw new AppError("search/fetch-failed", "Brave returned no extracted text for the exact requested URL");
    if (!Array.isArray(page.snippets) || page.snippets.some(chunk => typeof chunk !== "string")) throw malformed();
    const source = data.sources && typeof data.sources === "object" ? (data.sources as Record<string, { thumbnail?: unknown }>)[input.url] : undefined;
    const thumbnail = source?.thumbnail && typeof source.thumbnail === "object" ? source.thumbnail as Record<string, unknown> : {};
    return fetchResult("brave", input, { ...(input.includeImages ? { images: webImages([thumbnail.src], input.url, page.title) } : {}), url: input.url, title: page.title, text: page.snippets.join("\n\n"), warnings: [
      "Brave returned extracted text chunks for this exact URL, not a complete or live page fetch. Sections may be missing or reordered; freshness is not guaranteed. nextOffset continues these returned chunks only, not the full source page.",
      ...(input.fresh ? ["Brave LLM Context has no cache-bypass option; fresh=true cannot guarantee a new crawl."] : []),
    ] });
  } };
}
export const braveProvider: WebProvider = {
  id: "brave", label: "Brave", keyUrl: "https://api-dashboard.search.brave.com/app/keys", supportsFetch: true, create: createBraveClient,
  // Use an indexed provider-owned page; example.com may have no exact extracted source.
  connectionTestUrl: "https://brave.com/search/api/",
};
