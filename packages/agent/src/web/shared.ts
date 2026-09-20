import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebFetchInput, WebFetchResult, WebSearchInput, WebSearchResult, WebSource, WebImage } from "./types";

export const invalid = () => new AppError("search/invalid-input", "Invalid web retrieval input");
export const malformed = () => new AppError("search/provider", "Invalid web provider response");
export function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw invalid();
  return n;
}

/** Reject local/credential-bearing URL forms. Providers resolve page URLs remotely;
 * host image previews also use this lexical check before their bounded request. */
export function publicWebUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw invalid(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (raw.length > 2048 || !["https:", "http:"].includes(url.protocol) || url.username || url.password
    || (url.port && !["80", "443"].includes(url.port)) || !host.includes(".")
    || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    || host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) throw invalid();
  url.hash = "";
  return url.href;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw malformed();
  return value as Record<string, unknown>;
}
export const string = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
export function sourceUrl(value: unknown): string {
  if (typeof value !== "string") throw malformed();
  try { return publicWebUrl(value); } catch { throw malformed(); }
}
export function searchInput(input: WebSearchInput) {
  const query = input.query.trim();
  if (!query || query.length > 2000) throw invalid();
  const limit = bounded(input.limit, 5, 1, 10);
  if (input.recencyDays !== undefined) bounded(input.recencyDays, 1, 1, 3650);
  if (input.language !== undefined && !/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(input.language)) throw invalid();
  if (input.domains && (input.domains.length > 5 || input.domains.some(d => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(d)))) throw invalid();
  return { ...input, query, limit };
}
export function searchResult(provider: string, input: WebSearchInput, sources: WebSource[], warnings?: string[]): WebSearchResult {
  const allowed = sources.filter(source => !input.domains?.length || input.domains.some(domain => {
    const host = new URL(source.url).hostname.toLowerCase().replace(/\.$/, "");
    return host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`);
  }));
  const seen = new Set<string>();
  return { provider, query: input.query, retrievedAt: new Date().toISOString(),
    sources: allowed.filter(source => { if (seen.has(source.url)) return false; seen.add(source.url); return true; }).slice(0, input.limit ?? 5),
    ...(warnings?.length ? { warnings } : {}) };
}
export function fetchInput(input: WebFetchInput) {
  return { ...input, url: publicWebUrl(input.url), offset: bounded(input.offset, 0, 0, 4_000_000), maxChars: bounded(input.maxChars, 8000, 500, 12000) };
}
export function fetchResult(provider: string, input: ReturnType<typeof fetchInput>, page: {
  url: unknown; title?: unknown; text: unknown; publishedAt?: unknown; warnings?: string[]; images?: WebImage[];
}): WebFetchResult {
  if (typeof page.text !== "string" || !page.text.trim()) throw new AppError("search/fetch-failed", "Page contains no readable text");
  if (input.offset > page.text.length) throw invalid();
  const end = Math.min(input.offset + input.maxChars, page.text.length);
  return { provider, url: input.url, finalUrl: sourceUrl(page.url), title: string(page.title, 300),
    text: page.text.slice(input.offset, end), offset: input.offset, nextOffset: end < page.text.length ? end : null,
    ...(input.includeImages ? { images: page.images ?? [] } : {}),
    retrievedAt: new Date().toISOString(), ...(typeof page.publishedAt === "string" ? { publishedAt: page.publishedAt.slice(0, 80) } : {}),
    ...(page.warnings?.length ? { warnings: page.warnings } : {}) };
}
export const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
export const domainQuery = (input: WebSearchInput) => input.domains?.length
  ? `${input.query} (${input.domains.map(domain => `site:${domain}`).join(" OR ")})` : input.query;

/** One bounded, cancellable transport boundary for every provider. No upstream
 * error body, credential-bearing URL (SerpAPI), or raw transport error escapes. */
export function jsonRequest(provider: string, apiKey: string, transport: AgentFetch,
  headers: Record<string, string>, accessStatuses: number[] = []) {
  return async (url: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    if (!apiKey.trim()) throw new AppError("search/not-configured", "Configure Search in Settings → AI");
    const timeout = AbortSignal.timeout(60_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      combined.throwIfAborted();
      const response = await transport(url, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: combined,
        headers: { Accept: "application/json", ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        const code = response.status === 401 ? "auth" : [402, 403, ...accessStatuses].includes(response.status) ? "access"
          : response.status === 429 ? "rate-limited" : [400, 422].includes(response.status) ? "invalid-input" : "provider";
        await response.body?.cancel().catch(() => {});
        throw new AppError(`search/${code}`, `${provider} HTTP ${response.status}`, { retryable: response.status === 429 || response.status >= 500 });
      }
      const reader = response.body?.getReader();
      if (!reader) throw malformed();
      const decoder = new TextDecoder(); let bytes = 0; let text = "";
      try {
        while (true) {
          combined.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 4_000_000) throw new AppError("search/too-large", "Web response exceeds 4 MB");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      combined.throwIfAborted();
      try { return record(JSON.parse(text)); } catch { throw malformed(); }
    } catch (error) {
      if (signal?.aborted) throw new AppError("search/cancelled", "Web retrieval cancelled");
      if (timeout.aborted) throw new AppError("search/timeout", "Web retrieval timed out", { retryable: true });
      if (error instanceof AppError) throw error;
      throw new AppError("search/network", "Web provider could not be reached", { retryable: true });
    }
  };
}
