import type { PluginBookContent, PluginMigrationStorage } from "@read-aware/plugin-types";
import type { FeedSubscription } from "./types";
import { digest } from "./identity";

type Context = { services: { storage: PluginMigrationStorage } };
export const CONTENT_COLLECTION = "feed-content";
export type CachedFeedContent = { version: 1; url: string; content: PluginBookContent };
const unavailable = () => Object.assign(new Error("Cached feed content is missing or invalid"), { code: "library/content-unavailable" });

export async function prepareContent(url: string, content: PluginBookContent): Promise<{ id: string; data: CachedFeedContent }> {
  const value: CachedFeedContent = { version: 1, url, content };
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > 4 * 1024 * 1024) {
    throw Object.assign(new Error("Cached feed exceeds 4 MiB"), { code: "plugin/payload-too-large" });
  }
  const id = await digest(json);
  return { id, data: value };
}

export async function cachedContent(ctx: Context, feed: FeedSubscription): Promise<PluginBookContent | null> {
  if (!feed.contentId) return null;
  const row = await ctx.services.storage.collection(CONTENT_COLLECTION).get<{ version: number; url: string; content: PluginBookContent }>(feed.contentId);
  const value = row?.data;
  if (!value || value.version !== 1 || value.url !== feed.url || !value.content || !Array.isArray(value.content.sections)
    || value.content.sections.length !== feed.articles.length
    || value.content.sections.some((section, index) => !section || typeof section.html !== "string" || section.id !== feed.articles[index]?.id)
    || await digest(JSON.stringify(value)) !== feed.contentId) throw unavailable();
  return structuredClone(value.content);
}
