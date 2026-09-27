import { createHash } from "node:crypto";

export const ORIGIN = "https://readaware.app";
export const MANIFEST_PATH = "/search-manifest.json";
export const INDEXNOW_KEY = "8ed986b9ae974eed8b63cce94762a5d4";

/** One public, canonical page and the hash of its search-visible content. */
export type SearchManifestPage = { url: string; hash: string };
/** The build's list of public pages, published as `search-manifest.json`. */
export type SearchManifest = { version: 1; pages: SearchManifestPage[] };

export async function contentHash(html: string): Promise<string> {
  const text: string[] = [];
  const attributes: (string | null)[][] = [];
  await new HTMLRewriter()
    .on("title, main", {
      text(chunk) {
        text.push(chunk.text);
      },
    })
    .on(
      'meta[name="description"], link[rel="canonical"], link[hreflang], main a, main img',
      {
        element(el) {
          attributes.push(
            ["content", "href", "hreflang", "src", "alt"].map((key) =>
              el.getAttribute(key),
            ),
          );
        },
      },
    )
    .transform(new Response(html))
    .text();
  // Ignore bundle hashes, preloads, CSS and React IDs, not visible copy/links.
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: text.join("").replace(/\s+/g, " ").trim(),
        attributes,
      }),
    )
    .digest("hex");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function isPublicPage(
  page: unknown,
  seen: ReadonlySet<string>,
): page is SearchManifestPage {
  if (
    !isRecord(page) ||
    typeof page.url !== "string" ||
    typeof page.hash !== "string"
  )
    return false;
  const url = new URL(page.url);
  return !(
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    page.url !== url.href ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/") ||
    !/^\/(?:[a-z0-9-]+\/)*$/.test(url.pathname) ||
    url.pathname.startsWith("/sync/") ||
    url.pathname.startsWith("/api/") ||
    !/^[a-f0-9]{64}$/.test(page.hash) ||
    seen.has(page.url)
  );
}

function assertManifest(value: unknown): asserts value is SearchManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.pages) ||
    !value.pages.length
  )
    throw new Error("Invalid search manifest");
  const pages: unknown[] = value.pages;
  const seen = new Set<string>();
  for (const page of pages) {
    if (!isPublicPage(page, seen))
      throw new Error("Invalid public page in search manifest");
    seen.add(page.url);
  }
}

/** Checks untrusted JSON (a build output, a live fetch or a saved checkpoint). */
export function validateManifest(value: unknown): SearchManifest {
  assertManifest(value);
  return value;
}

// The IndexNow CLI passes parsed JSON straight through, so both manifests are
// validated here rather than trusted from their declared types.
export function changedUrls(
  previous: SearchManifest | null,
  current: SearchManifest,
): string[] {
  validateManifest(current);
  if (previous) validateManifest(previous);
  const old = new Map(
    (previous?.pages ?? []).map((page) => [page.url, page.hash]),
  );
  const now = new Map(current.pages.map((page) => [page.url, page.hash]));
  return [...new Set([...now.keys(), ...old.keys()])]
    .filter((url) => old.get(url) !== now.get(url))
    .sort();
}

export function submissionUrls(
  deployed: SearchManifest | null,
  acknowledged: SearchManifest | null,
  current: SearchManifest,
): string[] {
  // Deployment and notification can succeed independently. Diff against the
  // last acknowledged manifest too, so a later deploy retries missed changes.
  const pending = acknowledged
    ? changedUrls(acknowledged, current)
    : current.pages.map((page) => page.url);
  return [...new Set([...changedUrls(deployed, current), ...pending])].sort();
}
