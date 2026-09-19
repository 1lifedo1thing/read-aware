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
export interface WebSearchResult { provider: string; query: string; sources: WebSource[]; retrievedAt: string }
export interface WebFetchInput { url: string; offset?: number; maxChars?: number; fresh?: boolean }
export interface WebFetchResult {
  provider: string; url: string; finalUrl: string; title: string; text: string;
  publishedAt?: string; retrievedAt: string; offset: number; nextOffset: number | null;
}
export interface WebClient {
  search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult>;
  fetch(input: WebFetchInput, signal?: AbortSignal): Promise<WebFetchResult>;
}
export interface WebPort extends WebClient { configured(): boolean }
export interface WebProvider {
  id: string;
  label: string;
  keyUrl: string;
  create(apiKey: string, transport: AgentFetch): WebClient;
}
