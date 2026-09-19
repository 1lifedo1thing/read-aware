import type { AgentFetch } from "../models/transport";

/** Provider-neutral contracts: the host owns credentials and transport. */
export interface WebSearchInput {
  query: string;
  limit?: number;
  recencyDays?: number;
  domains?: string[];
  language?: string;
}
export interface WebSource { title: string; url: string; snippet: string; publishedAt?: string }
export interface WebSearchResult { provider: string; query: string; sources: WebSource[]; retrievedAt: string; warnings?: string[] }
export interface WebFetchInput { url: string; offset?: number; maxChars?: number; fresh?: boolean }
export interface WebFetchResult {
  provider: string; url: string; finalUrl: string; title: string; text: string;
  publishedAt?: string; retrievedAt: string; offset: number; nextOffset: number | null;
  warnings?: string[];
}
export interface WebClient {
  search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult>;
  fetch(input: WebFetchInput, signal?: AbortSignal): Promise<WebFetchResult>;
}
export interface WebPort extends WebClient { configured(operation?: "search" | "fetch"): boolean }
export interface WebProvider {
  id: string;
  label: string;
  keyUrl: string;
  supportsFetch: boolean;
  create(apiKey: string, transport: AgentFetch): Pick<WebClient, "search"> & Partial<Pick<WebClient, "fetch">>;
}
