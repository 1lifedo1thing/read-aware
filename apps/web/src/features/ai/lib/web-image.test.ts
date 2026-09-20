import { expect, test } from "bun:test";
import { loadWebImage } from "./web-image";

const url = "https://images.example.org/figure.png";
test("image preview uses no credentials/referrer, forbids redirects and returns a bounded local blob", async () => {
  const blob = await loadWebImage(url, async (target, init) => {
    expect(target).toBe(url);
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(init?.headers).toBeUndefined();
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  }, new AbortController().signal);
  expect(blob.type).toBe("image/png"); expect(blob.size).toBe(3);
});
test("unsafe or cancelled requests never start; non-images, empty and oversized images fail", async () => {
  const unused = async () => { throw new Error("transport must not run"); };
  for (const target of ["http://images.example.org/a", "file:///tmp/a", "https://localhost/a", "https://user:pass@example.org/a"]) {
    await expect(loadWebImage(target, unused, new AbortController().signal)).rejects.toMatchObject({ code: "search/invalid-input" });
  }
  await expect(loadWebImage(url, unused, AbortSignal.abort())).rejects.toBeDefined();
  for (const [content, type] of [["<svg/>", "image/svg+xml"], ["<html/>", "text/html"], ["", "image/png"]]) {
    await expect(loadWebImage(url, async () => new Response(content, { headers: { "content-type": type! } }), new AbortController().signal)).rejects.toMatchObject({ code: "search/fetch-failed" });
  }
  let cancelled = false;
  await expect(loadWebImage(url, async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "image/png" } }), new AbortController().signal)).rejects.toMatchObject({ code: "search/too-large" });
  expect(cancelled).toBe(true);
});
