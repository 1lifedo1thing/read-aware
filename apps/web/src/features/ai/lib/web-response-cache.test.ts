import { expect, test } from "bun:test";
import { WEB_PROVIDERS } from "@read-aware/agent";
import { createCachedWebClient } from "./web-response-cache";
const url = "https://museum.example.org/roof";
const json = (value: unknown) => new Response(JSON.stringify(value));
test("search coalesces, continuation reuses full text with original timestamp, fresh bypasses cache", async () => {
  let calls = 0;
  const client = createCachedWebClient(WEB_PROVIDERS.tinyfish, "fixture", async (_url, init) => {
    calls++; await new Promise(resolve => setTimeout(resolve, 3));
    return init?.method === "POST" ? json({ results: [{ url, title: "Roof", text: "x".repeat(1400), image_links: ["https://images.example.org/a.png"] }], errors: [] }) : json({ results: [{ url, title: "Roof", snippet: "Timber" }] });
  });
  await Promise.all([client.search({ query: "roof" }), client.search({ query: "roof" })]); expect(calls).toBe(1);
  const first = await client.fetch!({ url, includeImages: true, maxChars: 500 });
  const next = await client.fetch!({ url, includeImages: true, offset: 500, maxChars: 1000 });
  expect(calls).toBe(2); expect(next.text.length).toBe(900); expect(next.retrievedAt).toBe(first.retrievedAt); expect(next.images).toHaveLength(1);
  await client.fetch!({ url, fresh: true }); expect(calls).toBe(3);
  await client.fetch!({ url, fresh: true }); expect(calls).toBe(4);
});
test("provider/credential instances are isolated and HTTP 200 extraction failures are retried", async () => {
  let calls = 0;
  const transport = async () => { calls++; return json({ results: calls === 1 ? [] : [{ url, raw_content: "Readable", images: [] }], failed_results: [] }); };
  const client = createCachedWebClient(WEB_PROVIDERS.tavily, "one", transport);
  await expect(client.fetch!({ url })).rejects.toMatchObject({ code: "search/fetch-failed" });
  expect((await client.fetch!({ url })).text).toBe("Readable"); expect(calls).toBe(2);
  await createCachedWebClient(WEB_PROVIDERS.tavily, "two", transport).fetch!({ url }); expect(calls).toBe(3);
});
test("one subscriber cancelling does not cancel another provider call", async () => {
  let calls = 0;
  const client = createCachedWebClient(WEB_PROVIDERS.tinyfish, "one", async (_url, init) => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10)); init?.signal?.throwIfAborted();
    return json({ results: [{ url, title: "Roof", snippet: "Timber" }] });
  });
  const controller = new AbortController();
  const first = client.search({ query: "roof" }, controller.signal);
  const second = client.search({ query: "roof" }); controller.abort();
  await expect(first).rejects.toMatchObject({ code: "search/cancelled" });
  expect((await second).sources).toHaveLength(1); expect(calls).toBe(1);
});
test("HTTP failures and malformed responses preserve provider errors and do not poison the cache", async () => {
  let calls = 0;
  const client = createCachedWebClient(WEB_PROVIDERS.exa, "fixture", async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 429 });
    if (calls === 2) return new Response("not json");
    return json({ results: [{ url, title: "Roof", text: "Timber beams" }] });
  });
  await expect(client.fetch!({ url })).rejects.toMatchObject({ code: "search/rate-limited" });
  await expect(client.fetch!({ url })).rejects.toMatchObject({ code: "search/provider" });
  expect((await client.fetch!({ url })).text).toBe("Timber beams"); expect(calls).toBe(3);
});
