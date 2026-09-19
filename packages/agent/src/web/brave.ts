import type { AgentFetch } from "../models/transport";
import type { WebClient, WebProvider } from "./types";
import { domainQuery, invalid, jsonRequest, malformed, record, searchInput, searchResult, since, sourceUrl, string } from "./shared";

function language(value: string) {
  const lower = value.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-hans") return "zh-hans";
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-hant") return "zh-hant";
  if (lower === "pt-br") return "pt-br";
  return lower.split("-")[0]!;
}
export function createBraveClient(apiKey: string, transport: AgentFetch): Pick<WebClient, "search"> {
  const request = jsonRequest("Brave", apiKey, transport, { "X-Subscription-Token": apiKey.trim() });
  return { async search(raw, signal) {
    const input = searchInput(raw);
    const query = domainQuery(input);
    // Brave's request limit includes the added site operators; never truncate a query.
    if (query.length > 600 || query.split(/\s+/).length > 75) throw invalid();
    const params = new URLSearchParams({ q: query, count: String(input.limit), extra_snippets: "true" });
    if (input.recencyDays) params.set("freshness", `${since(input.recencyDays).slice(0, 10)}to${new Date().toISOString().slice(0, 10)}`);
    if (input.language) params.set("search_lang", language(input.language));
    const data = await request(`https://api.search.brave.com/res/v1/web/search?${params}`, undefined, signal);
    if (data.type !== "search" || data.error !== undefined) throw malformed();
    // Brave legitimately omits the web object for an empty web result set.
    const rows = data.web === undefined ? [] : record(data.web).results;
    if (!Array.isArray(rows)) throw malformed();
    return searchResult("brave", input, rows.map(item => {
      const row = record(item);
      const extras = Array.isArray(row.extra_snippets) ? row.extra_snippets.filter(x => typeof x === "string") : [];
      return { title: string(row.title, 300), url: sourceUrl(row.url),
        snippet: string([string(row.description, 800), ...extras].filter(Boolean).join("\n"), 800),
        ...(typeof row.page_age === "string" ? { publishedAt: row.page_age.slice(0, 80) } : {}) };
    }));
  } };
}
export const braveProvider: WebProvider = {
  id: "brave", label: "Brave", keyUrl: "https://api-dashboard.search.brave.com/app/keys", supportsFetch: false, create: createBraveClient,
};
