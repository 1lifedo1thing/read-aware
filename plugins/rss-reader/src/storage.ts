/**
 * Subscriptions live in the plugin document collection ("feeds", one document
 * per feed keyed by its URL) — the structured tier, so a large subscription
 * list never round-trips as one KV blob. Early versions stored a single KV
 * array under "feeds"; the schema migration adopts it before activation.
 */
import type { PluginMigrationStorage } from "@read-aware/plugin-types";
import type { FeedArticle, FeedSubscription } from "./types";
import { CONTENT_COLLECTION, type CachedFeedContent } from "./content-cache";

const COLLECTION = "feeds";

type StorageCtx = {
  services: { storage: PluginMigrationStorage };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readArticle(value: unknown): FeedArticle | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    link: typeof value.link === "string" ? value.link : undefined,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : undefined,
    publishedAtIso:
      typeof value.publishedAtIso === "string" ? value.publishedAtIso : undefined,
  };
}

export function readFeed(value: unknown): FeedSubscription | null {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.bookId !== "string" || value.removalId !== undefined && (typeof value.removalId !== "string" || !value.removalId || value.removalId.length > 80)
  ) {
    return null;
  }
  const articles = Array.isArray(value.articles)
    ? value.articles.map(readArticle).filter((article): article is FeedArticle => article !== null)
    : [];

  return {
    url: value.url,
    title: value.title,
    bookId: value.bookId,
    addedAt: typeof value.addedAt === "string" ? value.addedAt : "",
    lastFetched: typeof value.lastFetched === "string" ? value.lastFetched : "",
    articles,
    ...(typeof value.contentId === "string" ? { contentId: value.contentId } : {}),
    ...(value.contentPending === true ? { contentPending: true } : {}),
    ...(typeof value.removalId === "string" ? { removalId: value.removalId } : {}),
  };
}

/** All subscriptions, newest write first (the collection's natural order). */
export async function loadFeeds(ctx: StorageCtx): Promise<FeedSubscription[]> {
  const documents = await ctx.services.storage.collection(COLLECTION).list<unknown>({ limit: 1000 });
  return documents
    .map((document) => readFeed(document.data))
    .filter((feed): feed is FeedSubscription => feed !== null);
}

export async function getFeed(
  ctx: StorageCtx,
  url: string,
): Promise<FeedSubscription | null> {
  const document = await ctx.services.storage.collection(COLLECTION).get<unknown>(url);
  const feed = document ? readFeed(document.data) : null;
  if (document && !feed) throw Object.assign(new Error("Invalid RSS subscription"), { code: "plugin/invalid-data" });
  return feed;
}

const conflict = () => Object.assign(new Error("RSS storage changed; retry the operation"), { code: "plugin/storage-conflict" });
export async function upsertFeed(ctx: StorageCtx, feed: FeedSubscription, content?: CachedFeedContent): Promise<void> {
  // Cache and its published reference share one private-document transaction.
  // Re-publication after a collector ran must recreate/check the cache too.
  if (!feed.contentId) { await ctx.services.storage.collection(COLLECTION).put(feed.url, feed, { bookId: feed.bookId }); return; }
  const current = await ctx.services.storage.collection(COLLECTION).get(feed.url);
  const cached = await ctx.services.storage.collection(CONTENT_COLLECTION).get(feed.contentId);
  if (!content && !cached) throw Object.assign(new Error("Referenced RSS cache is missing"), { code: "library/content-unavailable" });
  const result = await ctx.services.storage.applyDocuments([
    { kind: "put", collection: COLLECTION, id: feed.url, expectedRevision: current?.revision ?? null, data: feed, bookId: feed.bookId },
    content
      ? { kind: "put", collection: CONTENT_COLLECTION, id: feed.contentId, expectedRevision: cached?.revision ?? null, data: content, bookId: feed.bookId }
      : { kind: "check", collection: CONTENT_COLLECTION, id: feed.contentId, expectedRevision: cached!.revision },
  ]);
  if (result.status !== "applied") throw conflict();
}

export async function removeFeed(ctx: StorageCtx, url: string, expected?: { bookId: string; removalId?: string }): Promise<void> {
  const document = await ctx.services.storage.collection(COLLECTION).get(url);
  if (!document) return;
  const feed = readFeed(document.data);
  if (!feed) throw Object.assign(new Error("Invalid RSS subscription"), { code: "plugin/invalid-data" });
  if (expected && (feed.bookId !== expected.bookId || feed.removalId !== expected.removalId)) throw conflict();
  const result = await ctx.services.storage.applyDocuments([{ kind: "delete", collection: COLLECTION, id: url, expectedRevision: document.revision }]);
  if (result.status !== "applied") throw conflict();
  if (feed.contentId) await discardUnreferencedContent(ctx, feed.contentId);
}

/**
 * One-time adoption of the pre-0.7 KV array. Documents win on collision (a
 * partially migrated install must not regress), and the KV key is removed
 * only after every entry landed.
 */
export async function migrateLegacyFeeds(ctx: StorageCtx): Promise<void> {
  const legacy = ctx.services.storage.get<unknown>("feeds");
  if (!Array.isArray(legacy)) return;
  for (const raw of legacy) {
    const feed = readFeed(raw);
    if (!feed) continue;
    const existing = await getFeed(ctx, feed.url);
    if (!existing) await upsertFeed(ctx, feed);
  }
  await ctx.services.storage.remove("feeds");
}


/** Conditional collection cleanup never deletes a currently published source. */
async function discardIfUnreferenced(ctx: StorageCtx, id: string, expectedRevision?: string): Promise<boolean> {
  const cached = await ctx.services.storage.collection(CONTENT_COLLECTION).get<{ url?: unknown }>(id);
  if (!cached || expectedRevision && cached.revision !== expectedRevision) return false;
  const url = cached.data?.url;
  if (typeof url !== "string" || !url) throw Object.assign(new Error("Invalid RSS cache owner"), { code: "plugin/invalid-data" });
  const document = await ctx.services.storage.collection(COLLECTION).get(url);
  const feed = document ? readFeed(document.data) : null;
  if (document && (!feed || feed.url !== url)) throw Object.assign(new Error("Invalid RSS subscription"), { code: "plugin/invalid-data" });
  if (feed?.contentId === id) return false;
  const result = await ctx.services.storage.applyDocuments([
    { kind: "check", collection: COLLECTION, id: url, expectedRevision: document?.revision ?? null },
    { kind: "delete", collection: CONTENT_COLLECTION, id, expectedRevision: cached.revision },
  ]);
  if (result.status !== "applied") throw conflict();
  return true;
}

export async function discardUnreferencedContent(ctx: StorageCtx, id: string): Promise<void> {
  try { await discardIfUnreferenced(ctx, id); }
  catch (error) { console.warn("RSS unreferenced content cleanup deferred", error); }
}

/** Scan without writes so pagination remains valid; retain only identities,
 * never the article bodies. Failures leave rows discoverable on the next run. */
export async function reclaimFeedContent(ctx: StorageCtx): Promise<{ scanned: number; removed: number }> {
  const candidates: { id: string; revision: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.services.storage.collection(CONTENT_COLLECTION).page({ limit: 100, cursor });
    if (page.status === "stale-cursor") throw conflict();
    for (const row of page.items) candidates.push({ id: row.id, revision: row.revision });
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  let removed = 0;
  for (const candidate of candidates) if (await discardIfUnreferenced(ctx, candidate.id, candidate.revision)) removed++;
  return { scanned: candidates.length, removed };
}


/** Save the user's deletion decision before crossing into host-owned storage.
 * Marking deletion does not require a still-readable cache. */
export async function markFeedRemoval(ctx: StorageCtx, url: string, expectedBookId?: string): Promise<FeedSubscription | null> {
  const document = await ctx.services.storage.collection(COLLECTION).get(url);
  if (!document) return null;
  const feed = readFeed(document.data);
  if (!feed) throw Object.assign(new Error("Invalid RSS subscription"), { code: "plugin/invalid-data" });
  if (expectedBookId !== undefined && feed.bookId !== expectedBookId) throw Object.assign(new Error("RSS subscription changed since approval"), { code: "reader/superseded" });
  if (feed.removalId) return feed;
  const marked = { ...feed, removalId: crypto.randomUUID() };
  const result = await ctx.services.storage.applyDocuments([{ kind: "put", collection: COLLECTION, id: url,
    expectedRevision: document.revision, data: marked, bookId: feed.bookId }]);
  if (result.status !== "applied") throw conflict();
  return marked;
}

/** Finish the read-only scan before writes invalidate its cursor. Store only
 * pending records; ordinary feed loading keeps its existing UI ordering. */
export async function pendingFeedRemovals(ctx: StorageCtx): Promise<FeedSubscription[]> {
  const pending: FeedSubscription[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.services.storage.collection(COLLECTION).page({ limit: 100, cursor });
    if (page.status === "stale-cursor") throw conflict();
    for (const row of page.items) {
      const feed = readFeed(row.data);
      if (!feed || feed.url !== row.id) throw Object.assign(new Error("Invalid RSS subscription"), { code: "plugin/invalid-data" });
      if (feed.removalId) pending.push(feed);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return pending;
}
