import { expect, test } from "bun:test";
import { createTinyFishClient } from "./tinyfish";
import { createBraveClient } from "./brave";
import { optionalImages } from "./optional-images";
import { webImages } from "./images";

const page = "https://museum.example.org/roof";
const picture = "https://images.example.org/roof.jpg";
const thumb = `${picture}?small=1`;
const json = (data: unknown) => new Response(JSON.stringify(data));

test("TinyFish reads only two unique ranked pages concurrently and cancels the slower one", async () => {
  const started: string[] = [];
  let slowerAborted = false;
  const client = createTinyFishClient("fixture", async () => json({ results: [page, page, `${page}/slow`, `${page}/third`].map(url => ({ url, title: "Roof", snippet: "Timber" })) }), {
    fetchPage: async (input, signal) => {
      started.push(input.url);
      expect(input.includeImages).toBe(true);
      if (input.url.endsWith("/slow")) return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => { slowerAborted = true; reject(new Error("cancelled")); }));
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(started).toEqual([page, `${page}/slow`]);
      return { provider: "tinyfish", url: page, finalUrl: page, title: "Roof", text: "The drawing shows timber joints.", offset: 0, nextOffset: null, retrievedAt: "2026-09-20T00:00:00Z", images: [{ url: picture, sourceUrl: page, title: "Roof" }] };
    },
  });
  expect((await client.search({ query: "roof" })).images).toBeUndefined();
  expect(started).toEqual([]);
  const result = await client.search({ query: "roof", includeImages: true });
  expect(result.images?.[0]?.url).toBe(picture);
  expect(result.imageContext?.[0]?.text).toContain("timber joints");
  expect(slowerAborted).toBe(true);
});

test("TinyFish redirects outside the requested domain and failed extraction keep only text", async () => {
  const client = createTinyFishClient("fixture", async (_url, init) => json(init?.body ? { results: [{ url: page, final_url: "https://elsewhere.example.org/roof", text: "Roof", image_links: [picture] }] }
    : { results: [{ url: page, title: "Roof", snippet: "Timber" }] }));
  const result = await client.search({ query: "roof", domains: ["museum.example.org"], includeImages: true });
  expect(result.sources).toHaveLength(1); expect(result.images).toEqual([]); expect(result.warnings).toHaveLength(1);
});

test("image deadline settles even for a transport ignoring abort; user cancellation still fails", async () => {
  let signal: AbortSignal | undefined;
  const result = await optionalImages(input => { signal = input; return new Promise(() => {}); }, undefined, 5);
  expect(result).toBeUndefined(); expect(signal?.aborted).toBe(true);
  const controller = new AbortController();
  const call = optionalImages(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await expect(call).rejects.toMatchObject({ code: "search/cancelled" });
});

test("Brave starts native images alongside web search, keeps attribution and preview, filters domains", async () => {
  const paths: string[] = [];
  const client = createBraveClient("fixture", async (url, init) => {
    expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("fixture");
    const path = new URL(String(url)).pathname; paths.push(path);
    await new Promise(resolve => setTimeout(resolve, 3));
    expect(paths).toHaveLength(2);
    return json(path.includes("/images/") ? { type: "images", results: [
      { url: page, title: "Timber joints", properties: { url: picture }, thumbnail: { src: thumb } },
      { url: "https://unrelated.example.org", title: "Unrelated", properties: { url: picture } },
    ] } : { type: "search", web: { results: [{ url: page, title: "Roof", description: "Timber" }] } });
  });
  const result = await client.search({ query: "roof", domains: ["MUSEUM.example.org"], includeImages: true });
  expect(result.images).toEqual([{ url: picture, thumbnailUrl: thumb, sourceUrl: page, title: "Timber joints", description: "Timber joints" }]);
});

test("Brave image access failure falls back to existing web thumbnails without losing sources", async () => {
  let imageCalls = 0;
  const client = createBraveClient("fixture", async url => {
    if (String(url).includes("/images/")) { imageCalls++; return new Response(null, { status: 403 }); }
    return json({ type: "search", web: { results: [{ url: page, title: "Roof", thumbnail: { src: thumb } }] } });
  });
  await client.search({ query: "roof" }); expect(imageCalls).toBe(0);
  const result = await client.search({ query: "roof", includeImages: true });
  expect(result.sources).toHaveLength(1); expect(result.images?.[0]?.url).toBe(thumb); expect(result.warnings).toHaveLength(1);
});

test("returned responsive sizes preserve a small preview and a larger viewer image in either order", () => {
  const url = (size: number) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Roof.jpg/${size}px-Roof.jpg`;
  for (const sizes of [[960, 330, 40], [40, 330, 960]]) {
    const result = webImages(sizes.map(url), page, "Roof");
    expect(result).toEqual([{ url: url(960), thumbnailUrl: url(330), sourceUrl: page, title: "Roof" }]);
  }
  expect(webImages([{ url: picture, thumbnailUrl: "https://localhost/private" }], page, "Roof")[0]?.thumbnailUrl).toBeUndefined();
});

test("completing a provider response detaches its native request from later parent cancellation", async () => {
  let requestSignal: AbortSignal | null | undefined;
  const controller = new AbortController();
  const client = createTinyFishClient("fixture", async (_url, init) => { requestSignal = init?.signal; return json({ results: [] }); });
  await client.search({ query: "roof" }, controller.signal);
  controller.abort();
  expect(requestSignal?.aborted).toBe(false);
});


test("Brave does not silently return unfiltered image-index results for a dated query", async () => {
  let calls = 0;
  const client = createBraveClient("fixture", async url => {
    calls++; expect(String(url)).toContain("/web/search?");
    return json({ type: "search", web: { results: [{ url: page, title: "Roof", thumbnail: { src: thumb } }] } });
  });
  const result = await client.search({ query: "roof", recencyDays: 7, includeImages: true });
  expect(calls).toBe(1); expect(result.images?.[0]?.url).toBe(thumb);
  expect(result.warnings?.[0]).toContain("not date-verified");
});
