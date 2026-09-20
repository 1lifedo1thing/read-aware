import { describe, expect, test } from "bun:test";
import { WEB_PROVIDERS } from "./providers";
import { createExaClient } from "./exa";
import { createTavilyClient } from "./tavily";
import { createSerpApiClient } from "./serpapi";
import { createBraveClient } from "./brave";

const key = "private-provider-test-key";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const query = { query: "release", domains: ["example.org"], recencyDays: 7, language: "zh", limit: 1 };
const url = "https://docs.example.org/release";
const source = { title: "Release", url, snippet: "Cedar 4.2" };

test("Exa maps filters and highlights; contents freshness uses maxAgeHours, not deprecated livecrawl", async () => {
  const bodies: Record<string, unknown>[] = [];
  const client = createExaClient(key, async (request, init) => {
    expect(new Headers(init?.headers).get("x-api-key")).toBe(key);
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return String(request).endsWith("/search") ? json({ results: [{ title: "Release", url, highlights: ["Cedar 4.2"], publishedDate: "2026-09-19" }] })
      : json({ results: [{ url, title: "Release", text: "x".repeat(800) }] });
  });
  const result = await client.search(query);
  expect(result.sources).toEqual([{ ...source, publishedAt: "2026-09-19" }]);
  expect(result.warnings?.[0]).toContain("language");
  expect(bodies[0]).toMatchObject({ type: "auto", includeDomains: ["example.org"], numResults: 1, contents: { highlights: true } });
  expect(Date.parse(bodies[0]!.startPublishedDate as string)).toBeGreaterThan(Date.now() - 8 * 86400000);
  expect(await client.fetch({ url, fresh: true, maxChars: 500 })).toMatchObject({ nextOffset: 500, text: "x".repeat(500) });
  expect(bodies[1]).toEqual({ urls: [url], text: true, maxAgeHours: 0 });
  expect(await client.fetch({ url, offset: 500, maxChars: 500 })).toMatchObject({ nextOffset: null, text: "x".repeat(300) });
  expect(bodies[2]!.maxAgeHours).toBe(1);
  await expect(createExaClient(key, async () => json({ results: [], statuses: [{ status: "error" }] })).fetch({ url })).rejects.toMatchObject({ code: "search/fetch-failed" });
});

test("Tavily requests basic search without answer/auto upgrade; failed extraction is not empty success", async () => {
  const bodies: Record<string, unknown>[] = [];
  const client = createTavilyClient(key, async (request, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${key}`);
    bodies.push(JSON.parse(String(init?.body)));
    return String(request).endsWith("/search") ? json({ answer: "untrusted generated answer", results: [{ title: "Release", url, content: "Cedar 4.2" }] })
      : json({ results: [{ url, raw_content: "Original article" }], failed_results: [] });
  });
  expect((await client.search(query)).sources).toEqual([source]);
  expect(bodies[0]).toMatchObject({ search_depth: "basic", auto_parameters: false, include_answer: false, include_raw_content: false,
    max_results: 1, include_domains: ["example.org"], language: "zh" });
  expect(bodies[0]!.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(await client.fetch({ url, fresh: true })).toMatchObject({ text: "Original article", warnings: [expect.stringContaining("freshness is not guaranteed")] });
  expect(bodies[1]).toEqual({ urls: [url], extract_depth: "basic", format: "markdown", timeout: 45 });
  await expect(createTavilyClient(key, async () => json({ results: [], failed_results: [{ url, error: key }] })).fetch({ url })).rejects.toMatchObject({ code: "search/fetch-failed" });
  for (const status of [432, 433]) await expect(createTavilyClient(key, async () => json({ detail: key }, status)).search(query)).rejects.toMatchObject({ code: "search/access" });
});

test("SerpAPI uses Google organic sources, encodes its required query credential, and rejects HTTP 200 errors", async () => {
  const client = createSerpApiClient(key, async (request, init) => {
    const params = new URL(String(request)).searchParams;
    expect(params.get("engine")).toBe("google"); expect(params.get("api_key")).toBe(key);
    expect(params.get("q")).toBe("release (site:example.org)");
    expect(params.get("tbs")).toBe("qdr:d7"); expect(params.get("hl")).toBe("zh");
    expect(init?.redirect).toBe("error");
    return json({ search_metadata: { status: "Success" }, answer_box: { answer: "ignore me" }, ads: [{ link: "https://ads.example.org" }],
      organic_results: [{ title: "Release", link: url, snippet: "Cedar 4.2" }] });
  });
  const result = await client.search(query);
  expect(result.sources).toEqual([source]); expect(JSON.stringify(result)).not.toContain(key);
  const empty = createSerpApiClient(key, async () => json({ search_metadata: { status: "Success" }, error: "Google hasn't returned any results for this query." }));
  expect((await empty.search(query)).sources).toEqual([]);
  for (const body of [{ search_metadata: { status: "Error" }, error: key }, { search_metadata: { status: "Processing" } }, {}]) {
    await expect(createSerpApiClient(key, async () => json(body)).search(query)).rejects.toMatchObject({ code: "search/provider" });
  }
});

test("Brave maps Chinese variants, preserves dates/snippets, recognizes omitted empty web results", async () => {
  for (const [input, mapped] of [["zh", "zh-hans"], ["zh-TW", "zh-hant"], ["en-US", "en"], ["pt-BR", "pt-br"]]) {
    const client = createBraveClient(key, async (request, init) => {
      expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe(key);
      const params = new URL(String(request)).searchParams;
      expect(params.get("search_lang")).toBe(mapped); expect(params.get("count")).toBe("1");
      expect(params.get("freshness")).toMatch(/^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/);
      return json({ type: "search", web: { results: [{ title: "Release", url, description: "Cedar 4.2", extra_snippets: ["Official release"], page_age: "2026-09-19" }] } });
    });
    expect((await client.search({ ...query, language: input })).sources[0]).toMatchObject({ ...source, snippet: "Cedar 4.2\nOfficial release", publishedAt: "2026-09-19" });
  }
  expect((await createBraveClient(key, async () => json({ type: "search", query: { original: "no results" } })).search(query)).sources).toEqual([]);
  await expect(createBraveClient(key, async () => json({ type: "ErrorResponse", error: {} })).search(query)).rejects.toMatchObject({ code: "search/provider" });
  await expect(createBraveClient(key, async () => { throw new Error("must not call"); }).search({ query: "x".repeat(601) })).rejects.toMatchObject({ code: "search/invalid-input" });
});

test("Brave reads only exact-URL chunks through its own key and reports partial/freshness limits", async () => {
  const calls: string[] = [];
  const client = createBraveClient(key, async (request, init) => {
    calls.push(String(request));
    expect(String(request)).toBe("https://api.search.brave.com/res/v1/llm/context");
    expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe(key);
    expect(JSON.parse(String(init?.body))).toMatchObject({ q: url, maximum_number_of_tokens_per_url: 8192,
      context_threshold_mode: "disabled", enable_local: false });
    return json({ grounding: { generic: [
      { url: "https://example.org/related", title: "Wrong page", snippets: ["Not the requested page"] },
      { url, title: "Requested page", snippets: ["x".repeat(600), "y".repeat(200)] },
    ] } });
  });
  const first = await client.fetch({ url: `${url}#heading`, maxChars: 500, fresh: true });
  expect(first).toMatchObject({ provider: "brave", finalUrl: url, text: "x".repeat(500), nextOffset: 500 });
  expect(first.warnings?.join(" ")).toContain("not a complete or live page fetch");
  expect(first.warnings?.join(" ")).toContain("no cache-bypass");
  expect(await client.fetch({ url, offset: 500, maxChars: 500 })).toMatchObject({ text: "x".repeat(100) + "\n\n" + "y".repeat(200), nextOffset: null });
  expect(calls).toHaveLength(2);
});

test("Brave exact-URL misses, malformed or empty chunks fail without returning a related page", async () => {
  for (const rows of [[], [{ url: `${url}/other`, snippets: ["Wrong page"] }], [{ url: `${url}?different=1`, snippets: ["Wrong page"] }], [{ url, snippets: [] }]]) {
    await expect(createBraveClient(key, async () => json({ grounding: { generic: rows } })).fetch({ url }))
      .rejects.toMatchObject({ code: "search/fetch-failed" });
  }
  await expect(createBraveClient(key, async () => json({ grounding: { generic: [{ url, snippets: [123] }] } })).fetch({ url }))
    .rejects.toMatchObject({ code: "search/provider" });
  let calls = 0;
  const client = createBraveClient(key, async () => { calls++; return json({}); });
  for (const target of ["http://localhost/private", `https://example.org/${"x".repeat(600)}`]) {
    await expect(client.fetch({ url: target })).rejects.toMatchObject({ code: "search/invalid-input" });
  }
  await expect(client.fetch({ url }, AbortSignal.abort())).rejects.toMatchObject({ code: "search/cancelled" });
  expect(calls).toBe(0);
});

const payload = (id: string) => {
  const rows = ["https://notexample.org/", url, url, "https://example.org/other"].map(url => ({ url, link: url, title: "T", snippet: "S", content: "S", description: "S", highlights: ["S"] }));
  if (id === "brave") return { type: "search", web: { results: rows } };
  if (id === "serpapi") return { search_metadata: { status: "Success" }, organic_results: rows };
  return { results: rows };
};
for (const provider of Object.values(WEB_PROVIDERS).filter(p => p.id !== "tinyfish")) describe(provider.label, () => {
  test("domain allowlist and deduplication apply before the output limit", async () => {
    const result = await provider.create(key, async () => json(payload(provider.id))).search({ ...query, limit: 2 });
    expect(result.sources.map(s => s.url)).toEqual([url, "https://example.org/other"]);
  });
  test("HTTP failures and transport errors never leak keys or look like no results", async () => {
    for (const [status, code] of [[401, "auth"], [403, "access"], [429, "rate-limited"], [503, "provider"]] as const) {
      const error = await provider.create(key, async () => json({ error: key }, status)).search(query).catch(e => e);
      expect(error.code).toBe(`search/${code}`); expect(JSON.stringify(error)).not.toContain(key);
    }
    const error = await provider.create(key, async () => { throw new Error(`failed https://api/?api_key=${key}`); }).search(query).catch(e => e);
    expect(error.code).toBe("search/network"); expect(error.message).not.toContain(key);
  });
  test("bad inputs and pre-cancellation do not issue requests; responses are size bounded", async () => {
    let calls = 0;
    const client = provider.create(key, async () => { calls++; return json({}); });
    for (const input of [{ query: " " }, { query: "x", limit: 11 }, { query: "x", domains: ["a.com OR evil"] }, { query: "x", recencyDays: 0 }]) {
      await expect(client.search(input)).rejects.toMatchObject({ code: "search/invalid-input" });
    }
    await expect(client.search(query, AbortSignal.abort())).rejects.toMatchObject({ code: "search/cancelled" });
    expect(calls).toBe(0);
    let cancelled = false;
    const big = provider.create(key, async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4_000_001)); }, cancel() { cancelled = true; } })));
    await expect(big.search(query)).rejects.toMatchObject({ code: "search/too-large" }); expect(cancelled).toBe(true);
  });
});
