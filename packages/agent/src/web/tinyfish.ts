import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebClient, WebFetchInput, WebProvider, WebSearchInput } from "./types";

const invalid = () => new AppError("search/invalid-input", "Invalid web retrieval input");
const malformed = () => new AppError("search/provider", "Invalid TinyFish response");
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw invalid();
  return n;
};

/** Only public web URLs. TinyFish, not the device, resolves/fetches the target;
 * its redirect/DNS checks remain authoritative for remotely resolved addresses. */
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

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw malformed();
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function sourceUrl(value: unknown): string {
  if (typeof value !== "string") throw malformed();
  try { return publicWebUrl(value); } catch { throw malformed(); }
}

export function createTinyFishClient(apiKey: string, transport: AgentFetch): WebClient {
  async function request(url: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!apiKey.trim()) throw new AppError("search/not-configured", "Configure Search in Settings → AI");
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(60_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await transport(url, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: combined,
        headers: { "X-API-Key": apiKey.trim(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        // Never expose upstream bodies/headers: they can echo credentials.
        const code = response.status === 401 ? "auth" : response.status === 402 ? "access"
          : response.status === 429 ? "rate-limited" : response.status === 400 ? "invalid-input" : "provider";
        throw new AppError(`search/${code}`, `TinyFish HTTP ${response.status}`, { retryable: response.status === 429 || response.status >= 500 });
      }
      // Bound the wire payload before parsing. Fetch responses can contain whole PDFs.
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
      // Transport failures may include request headers; preserve only the classification.
      throw new AppError("search/network", "Web provider could not be reached", { retryable: true });
    }
  }

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
      return { provider: "tinyfish", query, sources, retrievedAt: new Date().toISOString() };
    },
    async fetch(input: WebFetchInput, signal) {
      const url = publicWebUrl(input.url);
      const offset = bounded(input.offset, 0, 0, 4_000_000);
      const maxChars = bounded(input.maxChars, 8000, 500, 12000);
      const data = await request("https://api.fetch.tinyfish.ai", {
        urls: [url], format: "markdown", ttl: input.fresh ? 0 : 3600, per_url_timeout_ms: 45000,
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
        retrievedAt: new Date().toISOString() };
    },
  };
}

export const tinyFishProvider: WebProvider = {
  id: "tinyfish", label: "TinyFish", keyUrl: "https://agent.tinyfish.ai/api-keys", create: createTinyFishClient,
};
