import type { WebImage } from "./types";
import { publicWebUrl } from "./shared";

/** Optional media must not turn an otherwise usable search into a failure. */
export function webImages(values: unknown, source: unknown, title: unknown): WebImage[] {
  if (!Array.isArray(values) || typeof source !== "string") return [];
  let sourceUrl: string;
  try { sourceUrl = publicWebUrl(source); } catch { return []; }
  const seen = new Set<string>();
  return values.slice(0, 40).flatMap(value => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const raw = typeof value === "string" ? value : row.url;
    if (typeof raw !== "string") return [];
    try {
      const url = publicWebUrl(new URL(raw, sourceUrl).href);
      // Only HTTPS images are automatically loaded; inline data and local URLs
      // never become display candidates, even when supplied by a remote page.
      if (!url.startsWith("https:") || /\.(svg|ico)$/i.test(new URL(url).pathname) || seen.has(url)) return [];
      seen.add(url);
      return [{ url, sourceUrl, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : new URL(sourceUrl).hostname,
        ...(typeof row.description === "string" ? { description: row.description.slice(0, 500) } : {}) }];
    } catch { return []; }
  }).slice(0, 8);
}
