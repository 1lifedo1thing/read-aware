import type { AgentFetch } from "../models/transport";

/** Provider-neutral contracts: the host owns credentials and transport. */
export interface WebSearchInput {
  query: string;
  limit?: number;
  recencyDays?: number;
  domains?: string[];
  language?: string;
  includeImages?: boolean;
}
/** A provider-returned image tied to the page it came from, never a guessed URL. */
export interface WebImage { url: string; thumbnailUrl?: string; sourceUrl: string; title: string; description?: string }
export interface WebSource { title: string; url: string; snippet: string; publishedAt?: string }
export interface WebSearchResult { provider: string; query: string; sources: WebSource[]; retrievedAt: string; warnings?: string[]; images?: WebImage[];
  /** Bounded source excerpts read while looking for images, not whole pages. */
  imageContext?: Pick<WebFetchResult, "finalUrl" | "title" | "text" | "nextOffset" | "retrievedAt">[];
}
export interface WebFetchInput { url: string; offset?: number; maxChars?: number; fresh?: boolean; includeImages?: boolean }
export interface WebFetchResult {
  provider: string; url: string; finalUrl: string; title: string; text: string;
  publishedAt?: string; retrievedAt: string; offset: number; nextOffset: number | null;
  warnings?: string[];
  images?: WebImage[];
}
export interface WebClient {
  search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult>;
  fetch(input: WebFetchInput, signal?: AbortSignal): Promise<WebFetchResult>;
}
export interface WebPort extends WebClient { configured(operation?: "search" | "fetch"): boolean }
export interface WebClientOptions {
  /** Reuse the host's cached page reader during optional search enrichment. */
  fetchPage?: WebClient["fetch"];
}
export interface WebProvider {
  id: string;
  label: string;
  keyUrl: string;
  supportsFetch: boolean;
  /** A public source available to this provider's page-reading API. */
  connectionTestUrl?: string;
  create(apiKey: string, transport: AgentFetch, options?: WebClientOptions): Pick<WebClient, "search"> & Partial<Pick<WebClient, "fetch">>;
}
