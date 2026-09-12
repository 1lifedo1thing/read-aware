import { fetchFeed, isHttpFeedUrl } from "./feed";
import { cachedContent, prepareContent } from "./content-cache";
import { discardUnreferencedContent, getFeed, loadFeeds, markFeedRemoval, pendingFeedRemovals, reclaimFeedContent, removeFeed, upsertFeed } from "./storage";
import { PROVIDER_ID, type FeedSubscription, type RssPluginContext } from "./types";

const recoveries = new WeakMap<RssPluginContext, Promise<unknown>>();
const queues = new WeakMap<RssPluginContext, Map<string, Promise<unknown>>>();
function serial<T>(ctx: RssPluginContext, url: string, work: () => Promise<T>): Promise<T> {
  let queue = queues.get(ctx);
  if (!queue) {
    queue = new Map(); queues.set(ctx, queue);
    // activate() is staging and cannot mutate storage. First actual work runs
    // after promotion; a failed recovery must not disable offline reading.
    const recovery = recoverFeedRemovals(ctx).catch(error => { console.warn("RSS removal recovery deferred", error); })
      .then(() => reclaimFeedContent(ctx)).catch(error => { console.warn("RSS cache recovery deferred", error); });
    recoveries.set(ctx, recovery);
  }
  const next = (queue.get(url) ?? recoveries.get(ctx)!).catch(() => { /* A failed operation must not block later explicit retries. */ }).then(work);
  queue.set(url, next);
  const cleanup = () => { if (queue.get(url) === next) queue.delete(url); };
  void next.then(cleanup, cleanup);
  return next;
}

async function saveRefresh(ctx: RssPluginContext, url: string, notify: boolean): Promise<FeedSubscription> {
  const existing = await getFeed(ctx, url);
  assertNotRemoving(existing);
  const { title, articles, content } = await fetchFeed(ctx, url);
  const book = await ctx.domains.library.commands.books.addVirtualBook({ providerId: PROVIDER_ID, key: url, title, author: "RSS" });
  const prepared = await prepareContent(url, content);
  const contentId = prepared.id;
  const now = new Date().toISOString();
  const pending = notify && (contentId !== existing?.contentId || existing.contentPending === true);
  let feed: FeedSubscription = { url, title, bookId: book.id, addedAt: existing?.addedAt || now, lastFetched: now, articles, contentId,
    ...(pending ? { contentPending: true } : {}) };
  try { await upsertFeed(ctx, feed, prepared.data); }
  catch (error) {
    if (contentId !== existing?.contentId) await discardUnreferencedContent(ctx, contentId);
    throw error;
  }
  try {
    if (pending) {
      await ctx.domains.library.commands.books.invalidateVirtualBook({ providerId: PROVIDER_ID, key: url });
      const { contentPending: _pending, ...published } = feed;
      await upsertFeed(ctx, published); feed = published;
    }
  } finally {
    if (existing?.contentId && existing.contentId !== contentId) await discardUnreferencedContent(ctx, existing.contentId);
  }
  return feed;
}

export function subscribe(ctx: RssPluginContext, rawUrl: string): Promise<FeedSubscription> {
  const url = rawUrl.trim();
  if (!isHttpFeedUrl(url)) return Promise.reject(new Error("Enter a valid http(s) feed URL"));
  return serial(ctx, url, () => saveRefresh(ctx, url, true));
}

/** Imports never refresh an existing subscription, even when two imports race. */
export function subscribeIfMissing(ctx: RssPluginContext, url: string): Promise<{ created: boolean; feed: FeedSubscription }> {
  if (!isHttpFeedUrl(url)) return Promise.reject(Object.assign(new Error("Invalid feed URL"), { code: "plugin/invalid-input" }));
  return serial(ctx, url, async () => {
    const existing = await getFeed(ctx, url);
    assertNotRemoving(existing);
    if (existing) return { created: false, feed: existing };
    return { created: true, feed: await saveRefresh(ctx, url, true) };
  });
}

export function ensureBook(ctx: RssPluginContext, input: FeedSubscription): Promise<FeedSubscription> {
  return serial(ctx, input.url, async () => {
    const feed = await getFeed(ctx, input.url);
    if (!feed) throw Object.assign(new Error("RSS subscription was removed"), { code: "library/book-not-found" });
    assertNotRemoving(feed);
    const book = await ctx.domains.library.commands.books.addVirtualBook({ providerId: PROVIDER_ID, key: feed.url, title: feed.title, author: "RSS" });
    if (book.id === feed.bookId) return feed;
    const healed = { ...feed, bookId: book.id }; await upsertFeed(ctx, healed); return healed;
  });
}

export function loadFeedContent(ctx: RssPluginContext, url: string) {
  return serial(ctx, url, async () => {
    const feed = await getFeed(ctx, url);
    if (!feed) throw Object.assign(new Error("RSS subscription was removed"), { code: "library/book-not-found" });
    assertNotRemoving(feed);
    const cached = await cachedContent(ctx, feed);
    if (cached) return cached;
    // First load of a pre-cache subscription establishes its initial snapshot;
    // invalidating from inside load would reject that same reader's opening.
    const seeded = await saveRefresh(ctx, url, false);
    const content = await cachedContent(ctx, seeded);
    if (!content) throw Object.assign(new Error("RSS content was not saved"), { code: "library/content-unavailable" });
    return content;
  });
}

export function unsubscribeFeed(ctx: RssPluginContext, url: string, expectedBookId?: string): Promise<void> {
  return serial(ctx, url, async () => {
    const feed = await markFeedRemoval(ctx, url, expectedBookId);
    if (feed) await finishFeedRemoval(ctx, feed);
    else await ctx.domains.library.commands.books.removeVirtualBook({ providerId: PROVIDER_ID, key: url, expectedBookId });
  });
}

export async function forgetRemovedBook(ctx: RssPluginContext, bookId: string): Promise<FeedSubscription | null> {
  const feed = (await loadFeeds(ctx)).find(feed => feed.bookId === bookId);
  if (!feed) return null;
  return serial(ctx, feed.url, async () => {
    const current = await getFeed(ctx, feed.url);
    if (current?.bookId !== bookId) return null;
    await removeFeed(ctx, feed.url, { bookId, removalId: current.removalId });
    return feed;
  });
}

export async function openFeed(ctx: RssPluginContext, input: FeedSubscription, articleId?: string): Promise<void> {
  let feed = await ensureBook(ctx, input);
  await loadFeedContent(ctx, feed.url);
  const current = await getFeed(ctx, feed.url);
  if (!current || articleId && !current.articles.some(article => article.id === articleId)) {
    throw Object.assign(new Error("RSS article no longer exists in this snapshot"), { code: "reader/target-not-found" });
  }
  feed = current;
  let session = await ctx.domains.reading.queries.session();
  if (session.bookId === feed.bookId && session.sessionId) {
    const source = await ctx.domains.library.queries.books.getContentState(feed.bookId);
    if (session.status !== "ready" || source.sourceRevision !== session.sourceRevision) {
      await ctx.domains.reading.commands.reload({ bookId: feed.bookId, sessionId: session.sessionId });
    }
  }
  await ctx.domains.reading.commands.openBook(feed.bookId);
  session = await ctx.domains.reading.queries.session();
  if (articleId) await ctx.domains.reading.commands.goTo({ bookId: feed.bookId, href: articleId, contentVersion: session.location?.contentVersion });
}


function assertNotRemoving(feed: FeedSubscription | null): void {
  if (feed?.removalId) throw Object.assign(new Error("RSS removal is pending; finish unsubscribe before opening or refreshing"), { code: "plugin/storage-conflict" });
}
async function finishFeedRemoval(ctx: RssPluginContext, feed: FeedSubscription): Promise<void> {
  const current = await getFeed(ctx, feed.url);
  if (!current) return;
  if (!feed.removalId || current.removalId !== feed.removalId || current.bookId !== feed.bookId) {
    throw Object.assign(new Error("RSS removal intent was replaced"), { code: "plugin/storage-conflict" });
  }
  await ctx.domains.library.commands.books.removeVirtualBook({ providerId: PROVIDER_ID, key: feed.url, expectedBookId: feed.bookId });
  await removeFeed(ctx, feed.url, { bookId: feed.bookId, removalId: feed.removalId });
}
export async function recoverFeedRemovals(ctx: RssPluginContext): Promise<void> {
  let failure: unknown;
  for (const feed of await pendingFeedRemovals(ctx)) {
    try { await finishFeedRemoval(ctx, feed); }
    catch (error) { failure ??= error; console.warn("RSS pending removal failed", error); }
  }
  if (failure) throw failure;
}

/** Automatic refresh completes a recorded removal instead of resubscribing.
 * Re-read under the same URL queue, since the initial listing can be stale. */
export function refreshFeed(ctx: RssPluginContext, url: string): Promise<FeedSubscription | null> {
  return serial(ctx, url, async () => {
    const feed = await getFeed(ctx, url);
    if (!feed) return null;
    if (feed.removalId) { await finishFeedRemoval(ctx, feed); return null; }
    return saveRefresh(ctx, url, true);
  });
}
