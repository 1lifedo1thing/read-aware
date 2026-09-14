import type { PluginContext, PluginDetailView, PluginListItem, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";

type SavedPage = { version: 1; cursor: string; ids: string[]; general: boolean; hasMore: boolean; baseline: boolean; reset: boolean };
type OpenDetail = (ctx: PluginContext, bookId: string, title: string) => Promise<PluginDetailView>;
// Multiple popups share one activation's durable position. Never overwrite a
// newer processed page with a late response from another popup.
let tail: Promise<unknown> = Promise.resolve();
export function bookUpdates(ctx: PluginContext, openDetail: OpenDetail, advance = false): Promise<PluginListView> {
  const result = tail.then(() => load(ctx, openDetail, advance));
  tail = result.then(() => {}, () => {});
  return result;
}
function savedPage(value: unknown): SavedPage | null {
  if (value === null) return null;
  const page = value as SavedPage;
  if (!page || page.version !== 1 || typeof page.cursor !== "string" || !/^[a-f0-9]{48}$/.test(page.cursor)
    || !Array.isArray(page.ids) || page.ids.length > 50 || page.ids.some(id => typeof id !== "string" || !id || id.length > 512)
    || [page.general, page.hasMore, page.baseline, page.reset].some(flag => typeof flag !== "boolean")) {
    throw Error("Invalid saved book updates");
  }
  return page;
}
async function load(ctx: PluginContext, openDetail: OpenDetail, advance: boolean): Promise<PluginListView> {
  const grant = ctx.grants.book;
  const session = grant.mode === "current" ? await ctx.domains.reading!.queries.session() : undefined;
  const bookId = grant.mode === "book" ? grant.bookId : session?.bookId;
  if (grant.mode !== "all" && !bookId) return { kind: "list", title: tr(ctx.locale, "bookUpdates"), items: [], emptyText: tr(ctx.locale, "updatesNeedBook") };
  const query = { areas: ["library" as const], ...(bookId ? { bookId } : {}) };
  const key = `book-updates:v1:${bookId ? `book:${bookId}` : "all"}`;
  let page = savedPage(await ctx.services.storage.getDurable(key));
  let changed = false;
  const baseline = async (reset: boolean): Promise<SavedPage> => {
    const { cursor } = await ctx.services.changes.open(query);
    // Open first: edits racing this snapshot remain in the subsequent feed.
    const books = await ctx.domains.library!.queries.books.list();
    return { version: 1, cursor, ids: books.filter(book => !bookId || book.id === bookId).slice(0, 20).map(book => book.id),
      general: false, hasMore: false, baseline: true, reset };
  };
  if (!page) { page = await baseline(false); changed = true; }
  else if (advance) {
    try {
      const next = await ctx.services.changes.read(query, page.cursor, 50);
      page = { version: 1, cursor: next.cursor, ids: [...new Set(next.changes.flatMap(change => change.bookId ? [change.bookId] : []))],
        general: next.changes.some(change => !change.bookId), hasMore: next.hasMore, baseline: false, reset: false };
    } catch (error) {
      if ((error as { code?: string })?.code !== "changes/cursor-expired") throw error;
      page = await baseline(true);
    }
    changed = true;
  }
  const items: PluginListItem[] = [{ id: "$notice", title: tr(ctx.locale, page.reset ? "updatesReset" : page.baseline ? "updatesBaseline" : "updatesNote") }];
  if (page.general) {
    // Reload the authorized shelf before acknowledging a non-book invalidation.
    await ctx.domains.library!.queries.books.list();
    items.push({ id: "$shelf", title: tr(ctx.locale, "updatesShelf") });
  }
  for (const id of page.ids) {
    const book = await ctx.domains.library!.queries.books.get(id);
    items.push(book ? { id, title: book.title, subtitle: book.format.toUpperCase(), icon: "book-open",
      onSelect: async () => ({ view: await openDetail(ctx, book.id, book.title) }) }
      : { id, title: tr(ctx.locale, "updatesRemoved") });
  }
  // Only acknowledge after current authorized reads succeed. Page and position
  // share one durable write; a lost response can be recovered by reopening.
  if (changed) await ctx.services.storage.set(key, page);
  if (session) {
    const current = await ctx.domains.reading!.queries.session();
    if (current.bookId !== session.bookId || current.sessionId !== session.sessionId) throw Error(tr(ctx.locale, "updatesNeedBook"));
  }
  return { kind: "list", title: tr(ctx.locale, "bookUpdates"), items,
    actions: [{ id: "check-updates", label: tr(ctx.locale, page.hasMore ? "updatesMore" : "updatesCheck"), icon: "arrows-clockwise",
      run: async () => ({ view: await bookUpdates(ctx, openDetail, true), navigation: "replace" }) }] };
}
