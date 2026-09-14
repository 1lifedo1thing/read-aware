import { registerAgentTools } from "../src/agent-tools";
import { expect, test } from "bun:test";
import type { PluginBookContent, PluginContext, PluginDisposable, PluginReactionEvent, PluginDocumentChange, PluginDocumentPageFilter, PluginToolDefinition } from "@read-aware/plugin-types";
import plugin from "../src/index";
import { parseFeed } from "../src/feed";
import { ensureBook, forgetRemovedBook, loadFeedContent, openFeed, recoverFeedRemovals, refreshFeed, subscribe, unsubscribeFeed } from "../src/feed-library";
import { getFeed, reclaimFeedContent, upsertFeed } from "../src/storage";
import type { RssPluginContext } from "../src/types";
import { importOpml } from "../src/opml-import";
import { feedDetailView, importOpmlView } from "../src/views";
import { refreshAllFeeds, REFRESH_SCHEDULE } from "../src/refresh";

const url = "https://example.com/feed";
const xml = (items: string) => `<rss><channel><title>Feed</title>${items}</channel></rss>`;
const item = (id: string, body = id) => `<item><guid>${id}</guid><title>${id}</title><description>${body}</description></item>`;

function fixture() {
  const tools: PluginToolDefinition[] = [];
  const uriHandlers: import("@read-aware/plugin-types").PluginUriHandler[] = [];
  const tables = new Map<string, Map<string, unknown>>();
  const table = (name: string) => { let values = tables.get(name); if (!values) { values = new Map(); tables.set(name, values); } return values; };
  const writes = new Map<string, number>();
  const revision = (name: string, id: string) => table(name).has(id) ? `${writes.get(`${name}:${id}`) ?? 0}:${JSON.stringify(table(name).get(id))}` : null;
  const state = { xml: xml(item("one")), fetches: 0, notifications: 0, offline: false, failIndex: false, failNotify: false, failedUrls: new Set<string>(),
    bookId: "book-1", adds: 0, removes: 0, removalTargets: [] as (string | undefined)[], failFeedDelete: false, removeHold: undefined as Promise<void> | undefined, failRemove: false, failCleanup: false, failRead: false, sourceRevision: "new", readingRevision: "old", readingBook: "book-1", events: [] as string[], hold: undefined as Promise<void> | undefined };
  let removed: ((event: import("@read-aware/plugin-types").PluginDomainEvent<"book.removed">) => Promise<void>) | undefined;
  let provider: ((key: string) => Promise<PluginBookContent>) | undefined;
  let scheduled: (() => void | Promise<void>) | undefined;
  const ctx = {
    locale: "en",
    lifecycle: { phase: "active" },
    withEvent: () => ({ ...ctx }),
    services: {
      storage: { get: () => null,
        applyDocuments: async (changes: PluginDocumentChange[]) => {
          for (let index = 0; index < changes.length; index++) {
            const change = changes[index]!;
            if (revision(change.collection, change.id) !== change.expectedRevision) return { status: "conflict", index };
          }
          if (changes.some(c => c.collection === "feeds" && c.kind === "put") && state.failIndex) throw Object.assign(Error("Index write failed"), { code: "db/locked" });
          if (changes.some(c => c.collection === "feeds" && c.kind === "delete") && state.failFeedDelete) throw Object.assign(Error("Feed deletion failed"), { code: "db/locked" });
          if (changes.some(c => c.collection === "feed-content" && c.kind === "delete") && state.failCleanup) throw Object.assign(Error("Cleanup failed"), { code: "db/locked" });
          for (const change of changes) {
            if (change.kind === "put") table(change.collection).set(change.id, structuredClone(change.data));
            if (change.kind === "delete") table(change.collection).delete(change.id);
            if (change.kind !== "check") writes.set(`${change.collection}:${change.id}`, (writes.get(`${change.collection}:${change.id}`) ?? 0) + 1);
          }
          return { status: "applied", documents: changes.filter(c => c.kind !== "check").map(c => ({ collection: c.collection, id: c.id, revision: revision(c.collection, c.id) })) };
        }, collection: (name: string) => ({
        put: async (id: string, data: unknown) => {
          if (name === "feeds" && state.failIndex) throw Object.assign(Error("Index write failed"), { code: "db/locked" });
          table(name).set(id, structuredClone(data));
          writes.set(`${name}:${id}`, (writes.get(`${name}:${id}`) ?? 0) + 1);
        },
        get: async (id: string) => { if (state.failRead) throw Error("Read failed"); return table(name).has(id) ? { id, data: structuredClone(table(name).get(id)), revision: revision(name, id), updatedAt: "" } : null; },
        delete: async (id: string) => { table(name).delete(id); },
        list: async () => [...table(name)].map(([id, data]) => ({ id, data: structuredClone(data), revision: revision(name, id), updatedAt: "" })),
        page: async ({ limit = 50, cursor }: { limit?: number; cursor?: string }) => {
          const rows = [...table(name)].sort(([a], [b]) => a.localeCompare(b)).map(([id, data]) => ({ id, data: structuredClone(data), revision: revision(name, id), updatedAt: "" }));
          const signature = JSON.stringify(rows.map(r => [r.id, r.revision]));
          const previous = cursor ? JSON.parse(cursor) as { offset: number; signature: string } : null;
          if (previous && previous.signature !== signature) return { status: "stale-cursor" };
          const offset = previous?.offset ?? 0;
          return { status: "ready", items: rows.slice(offset, offset + limit), nextCursor: offset + limit < rows.length ? JSON.stringify({ offset: offset + limit, signature }) : null };
        },
      }) },
      network: { fetch: async (url: string) => { state.fetches++; if (state.hold) await state.hold; if (state.offline || state.failedUrls.has(url)) throw Object.assign(Error("Offline"), { code: "plugin/network-timeout" }); return new Response(state.xml); } },
      ui: { showToast: () => {} }, schedules: { bind: (id: string, run: () => void | Promise<void>) => { expect(id).toBe(REFRESH_SCHEDULE); scheduled = run; return { dispose() {} }; } },
    },
    domains: {
      library: {
        commands: { books: {
          addVirtualBook: async () => { state.adds++; return { id: state.bookId }; },
          removeVirtualBook: async (input: { expectedBookId?: string }) => { state.removes++; state.removalTargets.push(input.expectedBookId); if (state.removeHold) await state.removeHold; if (state.failRemove) throw Object.assign(new Error("Removal failed"), { code: "db/locked" }); },
          invalidateVirtualBook: async ({ key }: { key: string }) => {
            state.notifications++;
            const feed = await getFeed(ctx, key);
            expect(feed?.contentId).toBeDefined(); expect(table("feed-content").has(feed!.contentId!)).toBe(true);
            if (state.failNotify) throw Object.assign(Error("Notification failed"), { code: "plugin/unavailable" });
            return { bookId: state.bookId, revision: "invalidated" };
          },
        } },
        queries: { books: { getContentState: async () => ({ sourceRevision: state.sourceRevision }) } },
        events: { subscribe: (_event: string, handler: typeof removed) => { removed = handler; return { dispose() {} }; } },
      },
      reading: {
        queries: { session: async () => ({ bookId: state.readingBook, status: "ready", sessionId: "session", sourceRevision: state.readingRevision,
          location: { bookId: state.readingBook, contentVersion: "current-version" } }) },
        commands: {
          reload: async (guard: unknown) => { expect(guard).toEqual({ bookId: state.bookId, sessionId: "session" }); state.events.push("reload"); state.readingRevision = state.sourceRevision; },
          openBook: async (bookId: string) => { state.events.push("open"); state.readingBook = bookId; },
          goTo: async (target: { bookId: string; href: string; contentVersion: string }) => { expect(target.contentVersion).toBe("current-version"); state.events.push(`go:${target.href}`); },
        },
      },
    },
    contributions: {
      uriHandlers: { register: (handler: import("@read-aware/plugin-types").PluginUriHandler) => { uriHandlers.push(handler);return {dispose(){}}; } },
      contentProviders: { register: (value: { load: typeof provider }) => { provider = value.load; return { dispose() {} }; } },
      headerActions: { register: () => ({ dispose() {} }) }, commands: { register: () => ({ dispose() {} }) }, agentTools: { register: (tool: PluginToolDefinition) => { tools.push(tool); return { dispose() {} }; } },
    },
  } as unknown as RssPluginContext;
  return { ctx, state, table, tools, uriHandlers, removed: (event: Parameters<NonNullable<typeof removed>>[0]) => removed!(event), provider: () => provider!, scheduled: () => scheduled!() };
}

test("registered schedule rejects partial/all feed failures instead of reporting success", async () => {
  const f = fixture(); await plugin.activate(f.ctx);
  await subscribe(f.ctx, url); await subscribe(f.ctx, `${url}/second`);
  f.state.failedUrls.add(url);
  const start = f.state.fetches;
  expect(await refreshAllFeeds(f.ctx)).toContain("1");
  expect(f.state.fetches - start).toBe(2);
  await expect(Promise.resolve(f.scheduled())).rejects.toMatchObject({ code: "plugin/network-timeout" });
  expect(f.state.fetches - start).toBe(4);
  f.state.offline = true;
  await expect(Promise.resolve(f.scheduled())).rejects.toMatchObject({ code: "plugin/network-timeout" });
  f.state.offline = false; f.state.failedUrls.clear();
  await f.scheduled();
  expect(f.table("feeds").size).toBe(2);
});

test("scheduled refresh handles an empty collection and keeps four-request batching", async () => {
  const f = fixture(); await plugin.activate(f.ctx); await f.scheduled();
  expect(f.state.fetches).toBe(0);
  for (let index = 0; index < 9; index++) await subscribe(f.ctx, `${url}/${index}`);
  let release!: () => void;
  f.state.hold = new Promise<void>(resolve => { release = resolve; });
  const start = f.state.fetches, running = f.scheduled();
  await Bun.sleep(0); expect(f.state.fetches - start).toBe(4);
  release(); await running;
  expect(f.state.fetches - start).toBe(9);
});

const opml = (urls: string[]) => `<opml><body>${urls.map(url => `<outline xmlUrl="${url}"/>`).join("")}</body></opml>`;

test("OPML pages distinguish existing, added and failed entries and never refresh existing feeds", async () => {
  const f = fixture(); await plugin.activate(f.ctx); await subscribe(f.ctx, url);
  const urls = [url, ...Array.from({ length: 11 }, (_, index) => `${url}/${index}`)];
  f.state.failedUrls.add(urls[1]!);
  const input = opml(urls);
  const importer = f.tools.find(tool => tool.name === "import_opml")!;
  expect(importer.approval).toBe("required"); expect(importer.contexts).toEqual(["global"]);
  const page = await importer.execute({ opml: input });
  expect(page).toMatchObject({ total: 12, offset: 0, nextOffset: 10, added: 8, existing: 1, failed: 1 });
  expect((page as Awaited<ReturnType<typeof importOpml>>).items.map(item => item.url)).toEqual(urls.slice(0, 10));
  expect(f.state.fetches).toBe(10);
  expect(await importOpml(f.ctx, input, 10)).toMatchObject({ nextOffset: null, added: 2, failed: 0 });
  const failed = (page as Awaited<ReturnType<typeof importOpml>>).items[1]!;
  expect(failed).toEqual({ url: urls[1]!, status: "failed", errorCode: "plugin/network-timeout" });
  const before = f.state.fetches;
  await expect(importOpml(f.ctx, input, -1)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  await expect(importOpml(f.ctx, input, 0, 21)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  await expect(importOpml(f.ctx, "<opml/>")).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(f.state.fetches).toBe(before);
});

test("concurrent OPML imports create each subscription once and UI returns a paged outcome", async () => {
  const f = fixture(), input = opml([url]);
  const results = await Promise.all([importOpml(f.ctx, input), importOpml(f.ctx, input)]);
  expect(results.map(result => result.added).sort()).toEqual([0, 1]); expect(f.state.fetches).toBe(1);
  const form = importOpmlView(f.ctx, input);
  expect(form.fields[0]).toMatchObject({ value: input });
  expect(await form.onSubmit({ opml: "" })).toHaveProperty("fieldErrors.opml");
  const result = await form.onSubmit({ opml: input });
  expect(result).toMatchObject({ navigation: "replace", view: { kind: "detail", title: "Import OPML" } });
  expect(JSON.stringify(result)).toContain("already subscribed");
});

test("RSS unsubscribe tool requires approval, refuses changed bindings and preserves failed removals", async () => {
  const f = fixture(); await plugin.activate(f.ctx); const feed = await subscribe(f.ctx, url);
  const tool = f.tools.find(tool => tool.name === "unsubscribe_feed")!;
  expect(tool.approval).toBe("required"); expect(tool.contexts).toEqual(["global"]);
  await expect(tool.execute({ url, bookId: "old-book" })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(await getFeed(f.ctx, url)).not.toBeNull();
  f.state.failRemove = true;
  await expect(tool.execute({ url, bookId: feed.bookId })).rejects.toMatchObject({ code: "db/locked" });
  expect(await getFeed(f.ctx, url)).not.toBeNull();
  f.state.failRemove = false;
  expect(await tool.execute({ url, bookId: feed.bookId })).toEqual({ unsubscribed: true, url, bookId: feed.bookId });
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(0);
});

test("RSS IDs follow declared identities or links across insertion, reordering and edits", async () => {
  const before = await parseFeed(xml(item("one") + item("two")), url);
  const after = await parseFeed(xml(item("new") + item("two", "edited") + item("one") + item("one")), url);
  expect(after.articles).toHaveLength(3);
  expect(after.articles[1]!.id).toBe(before.articles[1]!.id);
  expect(after.articles[2]!.id).toBe(before.articles[0]!.id);
  expect(after.content.sections[1]!.html).toContain("edited");
  expect(before.articles[0]!.link).toBeUndefined();
  expect(before.content.sections[0]!.html).not.toContain("Read on the web");
  const atom = await parseFeed('<feed><entry><id>tag:stable</id><title>Before</title></entry></feed>', url);
  const atomEdit = await parseFeed('<feed><entry><id>tag:stable</id><title>After</title></entry></feed>', url);
  expect(atom.articles[0]!.id).toBe(atomEdit.articles[0]!.id);
  const linked = await parseFeed(xml('<item><link>/a</link><title>A</title></item>'), url);
  const linkedEdit = await parseFeed(xml('<item><link>/a</link><title>B</title></item>'), url);
  expect(linked.articles[0]!.id).toBe(linkedEdit.articles[0]!.id);
  const anonymous = await parseFeed(xml('<item><description>A</description></item><item><description>B</description></item>'), url);
  expect(anonymous.articles[0]!.id).not.toBe(anonymous.articles[1]!.id);
});

test("activated provider opens saved full content offline, and unchanged refresh does not invalidate", async () => {
  const f = fixture(); await plugin.activate(f.ctx);
  const feed = await subscribe(f.ctx, url);
  expect(feed.contentId).toMatch(/^[a-f0-9]{64}$/); expect(feed.contentPending).toBeUndefined();
  expect(f.state.notifications).toBe(1);
  await subscribe(f.ctx, url); expect(f.state.notifications).toBe(1);
  f.state.offline = true;
  const content = await f.provider()(url); content.sections[0]!.html = "mutated";
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
  expect(f.state.fetches).toBe(2); expect(f.table("feed-content").size).toBe(1);
  expect(JSON.stringify(f.table("feeds").get(url))).not.toContain('"html"');
});

test("failed network/index writes preserve the old readable snapshot and pending notification retries", async () => {
  const f = fixture(); const original = await subscribe(f.ctx, url);
  f.state.offline = true;
  await expect(subscribe(f.ctx, url)).rejects.toThrow("Offline");
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
  f.state.offline = false; f.state.xml = xml(item("one", "updated")); f.state.failIndex = true;
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "db/locked" });
  expect((await getFeed(f.ctx, url))?.contentId).toBe(original.contentId);
  expect(f.table("feed-content").size).toBe(1);
  f.state.failIndex = false; f.state.failNotify = true;
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect((await getFeed(f.ctx, url))?.contentPending).toBe(true);
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("updated");
  f.state.failNotify = false;
  expect((await subscribe(f.ctx, url)).contentPending).toBeUndefined();
  expect(f.state.notifications).toBe(3); expect(f.table("feed-content").size).toBe(1);
  f.state.xml = "x".repeat(4 * 1024 * 1024 + 1);
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "plugin/payload-too-large" });
});

test("legacy source seeds once; a missing or corrupt referenced cache is an error, not a network fallback", async () => {
  const f = fixture();
  f.table("feeds").set(url, { url, title: "Old", bookId: "book-1", articles: [{ id: "article-0", title: "Old" }] });
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
  expect(f.state.fetches).toBe(1); expect(f.state.notifications).toBe(0);
  const feed = (await getFeed(f.ctx, url))!;
  f.table("feed-content").set(feed.contentId!, { version: 1, url, content: { sections: [{ id: feed.articles[0]!.id, html: "corrupt" }] } });
  await expect(loadFeedContent(f.ctx, url)).rejects.toMatchObject({ code: "library/content-unavailable" });
  f.table("feed-content").clear();
  await expect(loadFeedContent(f.ctx, url)).rejects.toMatchObject({ code: "library/content-unavailable" });
  expect(f.state.fetches).toBe(1);
});

test("same-feed operations serialize and removed-book cleanup cannot delete a resubscription", async () => {
  const f = fixture(); let release!: () => void;
  f.state.hold = new Promise<void>(resolve => { release = resolve; });
  const first = subscribe(f.ctx, url), second = subscribe(f.ctx, url);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(f.state.fetches).toBe(1);
  release(); await Promise.all([first, second]);
  expect(f.state.fetches).toBe(2); expect(f.table("feed-content").size).toBe(1);
  await unsubscribeFeed(f.ctx, url);
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(0);
  f.state.bookId = "book-2"; await subscribe(f.ctx, url);
  expect(await forgetRemovedBook(f.ctx, "book-1")).toBeNull();
  expect((await getFeed(f.ctx, url))?.bookId).toBe("book-2");
});

test("explicit article open reloads an outdated current source before versioned navigation", async () => {
  const f = fixture(); const feed = await subscribe(f.ctx, url);
  await openFeed(f.ctx, feed, feed.articles[0]!.id);
  expect(f.state.events).toEqual(["reload", "open", `go:${feed.articles[0]!.id}`]);
  f.state.events = [];
  await openFeed(f.ctx, feed); expect(f.state.events).toEqual(["open"]);
  await expect(openFeed(f.ctx, feed, "article-0")).rejects.toMatchObject({ code: "reader/target-not-found" });
  expect(f.state.fetches).toBe(1);
});


test("first use after reactivation reclaims paged orphans and keeps every published snapshot", async () => {
  const f = fixture(); const feed = await subscribe(f.ctx, url);
  for (let index = 0; index < 205; index++) f.table("feed-content").set(`orphan-${index}`, { version: 1, url: `${url}/${index}`, content: {} });
  await plugin.activate({ ...f.ctx, lifecycle: { phase: "active" } });
  expect(f.table("feed-content").size).toBe(206); // Staging must not write.
  f.state.offline = true;
  expect((await f.provider()(url)).sections[0]!.html).toBe("one");
  expect([...f.table("feed-content").keys()]).toEqual([feed.contentId!]);
  expect(f.state.fetches).toBe(1);
});

test("failed cleanup remains discoverable and scheduled recovery retries even while offline", async () => {
  const f = fixture(); await plugin.activate(f.ctx); await subscribe(f.ctx, url);
  f.state.failCleanup = true;
  await unsubscribeFeed(f.ctx, url);
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(1);
  await expect(Promise.resolve(f.scheduled())).rejects.toMatchObject({ code: "db/locked" });
  f.state.failCleanup = false; f.state.offline = true;
  await f.scheduled();
  expect(f.table("feed-content").size).toBe(0);
});

test("collector cannot delete a source published after its read or silently treat bad reads as absence", async () => {
  const f = fixture(); const feed = await subscribe(f.ctx, url);
  f.table("feeds").delete(url);
  const apply = f.ctx.services.storage.applyDocuments;
  let once = true;
  f.ctx.services.storage.applyDocuments = async changes => {
    if (once && changes.some(c => c.kind === "delete" && c.collection === "feed-content")) {
      once = false;
      await upsertFeed(f.ctx, feed);
    }
    return apply(changes);
  };
  await expect(reclaimFeedContent(f.ctx)).rejects.toMatchObject({ code: "plugin/storage-conflict" });
  expect(f.table("feed-content").has(feed.contentId!)).toBe(true);
  f.state.failRead = true;
  await expect(reclaimFeedContent(f.ctx)).rejects.toThrow("Read failed");
  expect(f.table("feed-content").size).toBe(1);
  f.state.failRead = false;
  f.table("feeds").set(url, { malformed: true });
  await expect(reclaimFeedContent(f.ctx)).rejects.toMatchObject({ code: "plugin/invalid-data" });
  expect(f.table("feed-content").size).toBe(1);
});

test("collector does not commit partial snapshots after cursor invalidation", async () => {
  const f = fixture();
  for (let index = 0; index < 101; index++) f.table("feed-content").set(`orphan-${index}`, { url: `${url}/${index}` });
  const collection = f.ctx.services.storage.collection;
  f.ctx.services.storage.collection = name => {
    const value = collection(name);
    return { ...value, page: async <T>(filter?: PluginDocumentPageFilter) => {
      const page = await value.page<T>(filter);
      if (!filter?.cursor) f.table("feed-content").set("new", { url });
      return page;
    } };
  };
  await expect(reclaimFeedContent(f.ctx)).rejects.toMatchObject({ code: "plugin/storage-conflict" });
  expect(f.table("feed-content").size).toBe(102);
});

test("a collector winning the publication race leaves no dangling reference and explicit retry republishes atomically", async () => {
  const f = fixture(); const prior = await subscribe(f.ctx, url);
  f.table("feeds").delete(url);
  const apply = f.ctx.services.storage.applyDocuments;
  let once = true;
  f.ctx.services.storage.applyDocuments = async changes => {
    if (once && changes.some(c => c.kind === "put" && c.collection === "feed-content")) {
      once = false;
      await reclaimFeedContent(f.ctx);
    }
    return apply(changes);
  };
  await expect(subscribe(f.ctx, url)).rejects.toMatchObject({ code: "plugin/storage-conflict" });
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(0);
  expect((await subscribe(f.ctx, url)).contentId).toBe(prior.contentId);
  f.state.offline = true;
  expect((await loadFeedContent(f.ctx, url)).sections[0]!.html).toBe("one");
});


test("durable unsubscribe survives host success plus document failure and never reopens or refreshes the removed book", async () => {
  const f = fixture(); await plugin.activate(f.ctx); const feed = await subscribe(f.ctx, url);
  const oldView = feedDetailView(f.ctx, feed), before = { adds: f.state.adds, fetches: f.state.fetches };
  f.state.failFeedDelete = true;
  await expect(unsubscribeFeed(f.ctx, url, feed.bookId)).rejects.toMatchObject({ code: "db/locked" });
  const pending = (await getFeed(f.ctx, url))!; expect(pending.removalId).toBeString();
  expect(f.state.removalTargets[0]).toBe(feed.bookId);
  expect(feedDetailView(f.ctx, pending).actions!.map(action => action.id)).toEqual(["remove"]);
  const listed = await f.tools.find(tool => tool.name === "list_feeds")!.execute({});
  expect(listed).toMatchObject([{ removalPending: true, bookId: feed.bookId }]);
  await expect(ensureBook(f.ctx, feed)).rejects.toMatchObject({ code: "plugin/storage-conflict" });
  await expect(loadFeedContent(f.ctx, url)).rejects.toMatchObject({ code: "plugin/storage-conflict" });
  await expect(refreshFeed(f.ctx, url)).rejects.toMatchObject({ code: "db/locked" });
  expect({ adds: f.state.adds, fetches: f.state.fetches }).toEqual(before);
  f.state.failFeedDelete = false; f.state.offline = true;
  // New activation object consumes the same persisted private documents.
  const restarted = { ...f.ctx };
  await refreshAllFeeds(restarted);
  expect(await getFeed(f.ctx, url)).toBeNull(); expect(f.table("feed-content").size).toBe(0);
  await oldView.actions!.find(action => action.id === "refresh")!.run();
  expect({ adds: f.state.adds, fetches: f.state.fetches }).toEqual(before);
});

test("the removal decision must persist before host deletion; late cleanup preserves a replacement subscription", async () => {
  const f = fixture(); const feed = await subscribe(f.ctx, url);
  f.state.failIndex = true;
  await expect(unsubscribeFeed(f.ctx, url, feed.bookId)).rejects.toMatchObject({ code: "db/locked" });
  expect(f.state.removes).toBe(0); expect((await getFeed(f.ctx, url))!.removalId).toBeUndefined();
  f.state.failIndex = false;
  let release!: () => void; f.state.removeHold = new Promise<void>(resolve => { release = resolve; });
  const removal = unsubscribeFeed(f.ctx, url, feed.bookId); await Bun.sleep(0);
  expect(f.state.removes).toBe(1);
  const replacement = { ...feed, bookId: "replacement-book" };
  f.table("feeds").set(url, replacement); release();
  await expect(removal).rejects.toMatchObject({ code: "plugin/storage-conflict" });
  expect(await getFeed(f.ctx, url)).toEqual(replacement);
});

test("pending removal recovery scans every page before mutation and retains ordinary subscriptions", async () => {
  const f = fixture(); await subscribe(f.ctx, url);
  for (let index = 0; index < 205; index++) {
    const target = `${url}/pending-${index}`;
    f.table("feeds").set(target, { url: target, title: "Pending", bookId: `book-${index}`, addedAt: "", lastFetched: "", articles: [], removalId: `remove-${index}` });
  }
  await recoverFeedRemovals(f.ctx);
  expect(f.state.removes).toBe(205); expect(f.table("feeds").size).toBe(1); expect(await getFeed(f.ctx, url)).not.toBeNull();
  const malformed = `${url}/malformed`;
  f.table("feeds").set(malformed, { url: malformed, title: "Invalid", bookId: "invalid", removalId: [] });
  await expect(getFeed(f.ctx, malformed)).rejects.toMatchObject({ code: "plugin/invalid-data" });
  await expect(recoverFeedRemovals(f.ctx)).rejects.toMatchObject({ code: "plugin/invalid-data" });
  expect(f.state.removes).toBe(205); expect(f.table("feeds").has(malformed)).toBe(true);
});


test("RSS storage view and Agent query await durable writes and propagate failures", async () => {
  const { ctx, tools } = fixture();
  const { storageView } = await import("../src/storage-view");
  const calls: string[] = [];
  const policy = { usage: { kv:{items:1,valueBytes:2},documents:{items:3,valueBytes:4},assets:{items:0,valueBytes:0} }, assets:{maxItems:256,maxBytes:536870912}, documents:{applyMaxDocumentBytes:4194304,applyMaxBatchBytes:8388608} };
  ctx.services.storage.flush=async()=>{calls.push("flush");};
  ctx.services.storage.policy=async()=>{calls.push("policy");return policy as Awaited<ReturnType<typeof ctx.services.storage.policy>>;};
  const view=await storageView(ctx);expect(calls).toEqual(["flush","policy"]);expect(view.title).toBe("Stored data");
  expect(JSON.stringify(view.content)).toContain("not cached articles");
  registerAgentTools(ctx);
  expect(await tools.find(tool=>tool.name==="storage_policy")!.execute({})).toEqual(policy);
  ctx.services.storage.flush=async()=>{throw Object.assign(Error("Write failed"),{code:"db/locked"});};
  calls.length=0;await expect(storageView(ctx)).rejects.toMatchObject({code:"db/locked"});expect(calls).toEqual([]);
});


test("RSS URI consumer only prefills a draft; invalid or extra inputs never subscribe", async () => {
  const f=fixture();await plugin.activate(f.ctx);
  const handler=f.uriHandlers.find(item=>item.id==="subscribe")!;
  const result=await handler.open({parameters:[{key:"url",value:url}]});
  expect(result?.view).toMatchObject({kind:"form",fields:[{id:"url",value:url}]});
  expect(f.state.fetches).toBe(0);expect(f.state.adds).toBe(0);
  for(const parameters of [[],[{key:"url",value:"file:///private"}],[{key:"url",value:url},{key:"url",value:url}]])
    expect(()=>handler.open({parameters})).toThrow();
});


test("removed-book reaction uses its bound context and shares serialization with a concurrent user refresh", async () => {
  const f = fixture(); await plugin.activate(f.ctx); await subscribe(f.ctx, url);
  let release!: () => void;
  f.state.hold = new Promise<void>(resolve => { release = resolve; });
  const refresh = refreshFeed(f.ctx, url);
  await Bun.sleep(0);
  const reaction = { id: "host-event", status: "ready" as const };
  let bindings = 0, reactionWrites = 0;
  const originalWithEvent = f.ctx.withEvent;
  f.ctx.withEvent = ((event: PluginReactionEvent | undefined, registration?: PluginDisposable) => {
    if (registration) return originalWithEvent(event, registration);
    expect(event?.reaction).toBe(reaction); bindings++;
    return { ...f.ctx, services: { ...f.ctx.services, storage: { ...f.ctx.services.storage,
      applyDocuments: (changes: PluginDocumentChange[]) => { reactionWrites++; return f.ctx.services.storage.applyDocuments(changes); },
    } } };
  }) as PluginContext["withEvent"];
  const removal = f.removed({ type: "book.removed", payload: { bookId: "book-1" }, createdAt: "now", origin: "user", reaction });
  await Bun.sleep(0);
  expect(bindings).toBe(1); expect(reactionWrites).toBe(0);
  release(); await refresh; await removal;
  expect(reactionWrites).toBeGreaterThan(0); expect(await getFeed(f.ctx, url)).toBeNull();
});
