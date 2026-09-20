import { AppError } from "@read-aware/core";
import type { AgentFetch, WebClient, WebProvider, WebSearchResult } from "@read-aware/agent";
import { createRequestCache } from "../../../platform/request-cache";

/** Cache complete provider responses, before excerpt slicing, so nextOffset
 * reuses the same page snapshot instead of downloading that page again. */
export function createWebResponseCache(transport: AgentFetch, ttlMs: number) {
  const cache = createRequestCache<{ text: string; retrievedAt: string }>({ ttlMs, maxBytes: 16 * 1024 * 1024, maxEntries: 32, sizeOf: value => value.text.length * 2 });
  const keyOf = (url: Parameters<AgentFetch>[0], init?: Parameters<AgentFetch>[1]) => JSON.stringify([String(url), init?.method ?? "GET", init?.body ?? null]);
  const fetch: AgentFetch = async (url, init) => {
    const key = keyOf(url, init);
    const value = await cache.get(key, async signal => {
      const response = await transport(url, { ...init, signal });
      if (!response.ok) { await response.body?.cancel(); throw { status: response.status }; } // Return HTTP errors to the existing provider classifier; never cache them.
      const reader = response.body?.getReader();
      if (!reader) throw new AppError("search/provider", "Empty provider response");
      const decoder = new TextDecoder(); let text = "", size = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 4_000_000) throw new AppError("search/too-large", "Web response exceeds 4 MB");
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        // Malformed payloads must be retryable on the next request.
        try { JSON.parse(text); } catch { throw new AppError("search/provider", "Invalid web provider response"); }
        return { text, retrievedAt: new Date().toISOString() };
      } finally { await reader.cancel().catch(() => { /* Already complete or failing. */ }); reader.releaseLock(); }
    }, init?.signal ?? undefined).catch(error => {
      if (error && typeof error === "object" && "status" in error) return new Response(null, { status: error.status as number });
      throw error;
    });
    // Each caller gets an independent body, including coalesced HTTP failures.
    if (value instanceof Response) return value.clone();
    return new Response(value.text, { headers: { "content-type": "application/json", "x-readaware-retrieved-at": value.retrievedAt } });
  };
  return { fetch, clear: cache.clear, invalidate: (url: Parameters<AgentFetch>[0], init?: Parameters<AgentFetch>[1]) => cache.invalidate(keyOf(url, init)) };
}

/** The host reuses this client until its selected provider or key changes. */
export function createCachedWebClient(provider: WebProvider, key: string, transport: AgentFetch): Pick<WebClient, "search"> & Partial<Pick<WebClient, "fetch">> {
  const searches = createRequestCache<WebSearchResult>({ ttlMs: 60_000, maxBytes: 16 * 1024 * 1024, maxEntries: 32, sizeOf: result => JSON.stringify(result).length * 2 });
  const pages = createWebResponseCache(transport, 5 * 60_000);
  function operation(fetch: AgentFetch, cache?: ReturnType<typeof createWebResponseCache>) {
    let retrievedAt: string | null = null;
    let invalidate = () => {};
    const client = provider.create(key, async (url, init) => {
      invalidate = () => cache?.invalidate(url, init);
      const response = await fetch(url, init);
      retrievedAt = response.headers.get("x-readaware-retrieved-at");
      return response;
    });
    return { client, invalidate: () => invalidate(), stamp: <T extends { retrievedAt: string }>(result: T): T => retrievedAt ? { ...result, retrievedAt } : result };
  }
  return {
    async search(input, signal) {
      // Use logical inputs: Exa computes startPublishedDate from the clock, so
      // its raw HTTP body changes even for repeated identical queries.
      const cacheKey = JSON.stringify([input.query.trim(), input.limit ?? 5, input.recencyDays ?? null,
        input.domains?.map(domain => domain.toLowerCase()).sort() ?? [], input.language?.toLowerCase() ?? null, input.includeImages ?? false]);
      try {
        const result = await searches.get(cacheKey, signal => provider.create(key, transport).search(input, signal), signal);
        return structuredClone(result);
      } catch (error) {
        if (signal?.aborted) throw new AppError("search/cancelled", "Web retrieval cancelled");
        throw error;
      }
    },
    ...(provider.supportsFetch ? { async fetch(input: Parameters<WebClient["fetch"]>[0], signal?: AbortSignal) {
      if (input.fresh) pages.clear();
      const call = operation(input.fresh ? transport : pages.fetch, input.fresh ? undefined : pages);
      try { return call.stamp(await call.client.fetch!(input, signal)); }
      catch (error) { if (!signal?.aborted) call.invalidate(); throw error; }
    } } : {}),
  };
}
