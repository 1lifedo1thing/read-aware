import type { AgentFetch } from "../models/transport";
import type { WebClient, WebProvider } from "./types";
import { domainQuery, jsonRequest, malformed, record, searchInput, searchResult, sourceUrl, string } from "./shared";

export function createSerpApiClient(apiKey: string, transport: AgentFetch): Pick<WebClient, "search"> {
  const request = jsonRequest("SerpAPI", apiKey, transport, {});
  return { async search(raw, signal) {
    const input = searchInput(raw);
    const params = new URLSearchParams({ engine: "google", q: domainQuery(input), api_key: apiKey.trim() });
    if (input.recencyDays) params.set("tbs", `qdr:d${input.recencyDays}`);
    if (input.language) params.set("hl", input.language);
    const data = await request(`https://serpapi.com/search.json?${params}`, undefined, signal);
    const metadata = record(data.search_metadata);
    // SerpAPI reports this specific empty Google SERP as an error even on HTTP 200.
    const empty = data.error === "Google hasn't returned any results for this query.";
    if (metadata.status !== "Success" || (data.error !== undefined && !empty)) throw malformed();
    if (data.organic_results === undefined && empty) return searchResult("serpapi", input, []);
    if (!Array.isArray(data.organic_results)) throw malformed();
    return searchResult("serpapi", input, data.organic_results.map(item => {
      const row = record(item);
      return { title: string(row.title, 300), url: sourceUrl(row.link), snippet: string(row.snippet, 800),
        ...(typeof row.date === "string" ? { publishedAt: row.date.slice(0, 80) } : {}) };
    }));
  } };
}
export const serpApiProvider: WebProvider = {
  id: "serpapi", label: "SerpAPI (Google)", keyUrl: "https://serpapi.com/manage-api-key", supportsFetch: false, create: createSerpApiClient,
};
