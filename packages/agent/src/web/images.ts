import type { WebImage } from "./types";
import { publicWebUrl } from "./shared";

/** MediaWiki returns several responsive sizes of each asset, including UI icons.
 * Recognize its asset path, not the article topic; keep the returned URL intact. */
function imageAsset(url: string) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) if (key.startsWith("utm_")) parsed.searchParams.delete(key);
  const wiki = /(?:^|\.)wikimedia\.org$/.test(parsed.hostname);
  const thumb = wiki ? parsed.pathname.match(/^(\/wikipedia\/[^/]+)\/thumb\/([^/]+\/[^/]+\/[^/]+)\/(\d+)px-/) : null;
  const name = decodeURIComponent((thumb?.[2] ?? parsed.pathname).split("/").pop() ?? "");
  return {
    key: thumb ? `wikimedia:${thumb[1]}/${thumb[2]}` : parsed.href,
    width: thumb ? Number(thumb[3]) : 0,
    decoration: (/(?:^|\.)wikipedia\.org$/.test(parsed.hostname) && parsed.pathname.startsWith("/static/images/"))
      || (wiki && /^(?:Ambox_|Disambig_|Translation_to_|Question_book-)/i.test(name)),
  };
}

function thumbnailUrl(value: unknown, source: string): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = publicWebUrl(new URL(value, source).href);
    if (url.startsWith("https:") && !/\.(svg|ico)$/i.test(new URL(url).pathname)) return url;
  } catch { /* A malformed optional thumbnail must not discard the original. */ }
}

export const webImageIdentity = (url: string) => imageAsset(url).key;

/** Optional media must not turn an otherwise usable search into a failure. */
export function webImages(values: unknown, source: unknown, title: unknown): WebImage[] {
  if (!Array.isArray(values) || typeof source !== "string") return [];
  let sourceUrl: string;
  try { sourceUrl = publicWebUrl(source); } catch { return []; }
  const candidates = new Map<string, { image: WebImage; width: number; previewWidth?: number }>();
  for (const value of values.slice(0, 160)) {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const raw = typeof value === "string" ? value : row.url;
    if (typeof raw !== "string") continue;
    try {
      const url = publicWebUrl(new URL(raw, sourceUrl).href);
      // Only HTTPS images are automatically loaded; inline data and local URLs
      // never become display candidates, even when supplied by a remote page.
      if (!url.startsWith("https:") || /\.(svg|ico)$/i.test(new URL(url).pathname)) continue;
      const asset = imageAsset(url);
      if (asset.decoration) continue;
      const previous = candidates.get(asset.key);
      const explicitPreview = thumbnailUrl(row.thumbnailUrl, sourceUrl);
      const preview = asset.width >= 240 && (!previous?.previewWidth || asset.width < previous.previewWidth)
        ? { url, width: asset.width } : previous?.previewWidth ? { url: previous.image.thumbnailUrl ?? previous.image.url, width: previous.previewWidth } : undefined;
      const best = previous && previous.width >= asset.width ? previous.image : { url, sourceUrl,
        title: typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : new URL(sourceUrl).hostname,
        ...(typeof row.description === "string" ? { description: row.description.slice(0, 500) } : previous?.image.description ? { description: previous.image.description } : {}) };
      const thumb = explicitPreview ?? preview?.url ?? previous?.image.thumbnailUrl;
      candidates.set(asset.key, { width: Math.max(asset.width, previous?.width ?? 0), previewWidth: preview?.width,
        image: { ...best, ...(thumb && thumb !== best.url ? { thumbnailUrl: thumb } : {}) } });
    } catch { /* Ignore malformed optional media without losing page text. */ }
  }
  return [...candidates.values()].map(value => value.image).slice(0, 8);
}
