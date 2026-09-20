import { expect, test } from "bun:test";
import { webImages } from "./images";
import { WEB_PROVIDERS } from "./providers";

const source = "https://museum.example.org";
const image = "https://images.example.org/building.jpg";
const json = (value: unknown) => new Response(JSON.stringify(value));

test("image candidates are bounded, source-linked, deduplicated and HTTPS only", () => {
  const result = webImages(["/drawing.png", "/drawing.png", "/icon.svg", "/favicon.ico", "http://images.example.org/a", "file:///tmp/a", "https://localhost/a", "https://127.0.0.1/a", "data:image/png;base64,a", { url: image, description: "Roof section" }, null], source, "Museum");
  expect(result).toEqual([
    { url: `${source}/drawing.png`, sourceUrl: `${source}/`, title: "Museum" },
    { url: image, sourceUrl: `${source}/`, title: "Museum", description: "Roof section" },
  ]);
  expect(webImages([image], "file:///tmp/a", "Bad")).toEqual([]);
  expect(webImages(Array.from({ length: 20 }, (_, i) => `${image}?n=${i}`), source, "")).toHaveLength(8);
});

for (const id of ["brave", "exa", "tavily", "serpapi"] as const) test(`${id} returns images only for retained sources and only when requested`, async () => {
  const rows = [
    { url: "https://unrelated.example.net/page", link: "https://unrelated.example.net/page", title: "Excluded", image: "https://images.example.org/wrong.jpg", thumbnail: id === "brave" ? { src: "https://images.example.org/wrong.jpg" } : "https://images.example.org/wrong.jpg", images: ["https://images.example.org/wrong.jpg"] },
    { url: source, link: source, title: "Museum", image, thumbnail: id === "brave" ? { src: image } : image, images: [{ url: image, description: "Building" }] },
  ];
  const client = WEB_PROVIDERS[id].create("fixture-key", async () => json(id === "brave" ? { type: "search", web: { results: rows } }
    : id === "serpapi" ? { search_metadata: { status: "Success" }, organic_results: rows }
    : { results: rows, images: [{ url: "https://images.example.org/unattributed.jpg" }] }));
  const input = { query: "Museum", domains: ["museum.example.org"], limit: 1 };
  expect((await client.search(input)).images).toBeUndefined();
  expect((await client.search({ ...input, includeImages: true })).images).toEqual([
    { url: image, sourceUrl: `${source}/`, title: "Museum", ...(id === "tavily" ? { description: "Building" } : {}) },
  ]);
});

for (const id of ["tinyfish", "exa", "tavily", "brave"] as const) test(`${id} fetch requests and normalizes source images with the same provider`, async () => {
  let body: Record<string, unknown> = {};
  const client = WEB_PROVIDERS[id].create("fixture-key", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return json(id === "brave" ? { grounding: { generic: [{ url: source, title: "Museum", snippets: ["Building description"] }] }, sources: { [`${source}/`]: { thumbnail: { src: image, original: image } } } }
      : { results: [{ url: source, final_url: source, title: "Museum", text: "Building description", raw_content: "Building description", image_links: [image], extras: { imageLinks: [image] }, images: [image] }], errors: [], failed_results: [] });
  });
  const result = await client.fetch!({ url: source, includeImages: true });
  expect(result.images).toEqual([{ url: image, sourceUrl: `${source}/`, title: "Museum" }]);
  expect(body).toMatchObject(id === "tinyfish" ? { image_links: true } : id === "exa" ? { extras: { imageLinks: 8 } } : id === "tavily" ? { include_images: true } : { enable_source_metadata: true });
});
