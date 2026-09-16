import type { PluginAction, PluginDetailView, PluginDocument, PluginFormView, PluginListView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { BOOKMARKS, bookmarkCollection, bookmarkName, bookmarkSearchQuery, captureBookmark, openBookmark, parseBookmark, removeBookmark, writeBookmark, type Bookmark } from "./bookmarks";
import { bookmarkCopy } from "./bookmark-strings";
import type { JumperContext } from "./types";
import { liveBookmarks, type BookmarkReadView } from "./live-bookmarks";
import { tr } from "./strings";

/** Conflicts and stale pages: an explanation with one way back to a fresh list. */
function message(ctx: JumperContext, text: string, refresh = () => bookmarksView(ctx)): PluginDetailView {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "primary", run: async () => ({ view: await refresh(), navigation: "reset" }) },
  ] };
}

/** A successful write returns to the list with a toast; the list re-reads, so no receipt page is needed. */
async function done(ctx: JumperContext, toast: string): Promise<PluginViewResult> {
  return { view: await bookmarksView(ctx), navigation: "reset", toast };
}

function nameForm(ctx: JumperContext, data: Bookmark, id: string, expectedRevision: string | null): PluginFormView {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "form", title: expectedRevision === null ? t.save : t.rename, submitLabel: expectedRevision === null ? t.save : t.rename,
    fields: [{ id: "name", kind: "text", label: t.name, value: data.name }], onSubmit: async values => {
      const name = bookmarkName(values.name);
      if (!name) return { fieldErrors: { name: t.invalidName } };
      const receipt = await writeBookmark(ctx, id, { ...data, name }, expectedRevision);
      if (receipt.status === "conflict") return { view: message(ctx, t.conflict), navigation: "replace" };
      return done(ctx, expectedRevision === null ? t.saved : t.renamed);
    } };
}

export async function saveBookmarkView(ctx: JumperContext, kind: Bookmark["kind"]): Promise<PluginView> {
  const data = await captureBookmark(ctx, kind), t = bookmarkCopy(ctx.locale);
  return { kind: "blocks", title: kind === "selection" ? t.selection : t.current, blocks: [
    { kind: "keyValue", rows: [{ label: t.book, value: data.bookTitle }, { label: t.kind, value: kind === "selection" ? t.range : t.location }] },
    nameForm(ctx, data, crypto.randomUUID(), null),
  ] };
}

function deleteForm(ctx: JumperContext, doc: PluginDocument): PluginFormView {
  const t = bookmarkCopy(ctx.locale), bookmark = parseBookmark(doc.data);
  return { kind: "form", title: bookmark?.name ?? t.invalid, submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirm, value: false }], onSubmit: async values => {
      if (values.confirm !== true) return { fieldErrors: { confirm: t.required } };
      const receipt = await removeBookmark(ctx, doc);
      if (receipt.status === "conflict") return { view: message(ctx, t.conflict), navigation: "replace" };
      return done(ctx, t.removed);
    } };
}

export async function bookmarkDetail(ctx: JumperContext, id: string): Promise<BookmarkReadView> {
  const t = bookmarkCopy(ctx.locale);
  return liveBookmarks(ctx, { kind: "get", collection: BOOKMARKS, id },
    async () => ({ kind: "get", document: await bookmarkCollection(ctx).get(id) }), async result => {
  if (result.kind !== "get") throw Error("Expected bookmark document");
  const doc = result.document;
  if (!doc) return message(ctx, t.missing);
  const bookmark = parseBookmark(doc.data);
  const actions: PluginAction[] = [];
  if (bookmark) actions.push(
    { id: "open", label: t.open, icon: "arrow-right", variant: "solid", priority: "primary", run: () => openBookmark(ctx, bookmark) },
    { id: "rename", label: t.rename, icon: "pencil-simple", priority: "secondary", run: () => ({ view: nameForm(ctx, bookmark, doc.id, doc.revision) }) },
  );
  actions.push(
    { id: "remove", label: t.remove, icon: "trash", variant: "danger", priority: "secondary", run: () => ({ view: deleteForm(ctx, doc) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: async () => ({ view: await bookmarkDetail(ctx, id), navigation: "replace" }) },
  );
  return { kind: "detail", title: bookmark?.name ?? t.invalid,
    content: bookmark ? [{ kind: "keyValue", rows: [
      { label: t.book, value: bookmark.bookTitle }, { label: t.kind, value: bookmark.kind === "selection" ? t.range : t.location },
      { label: t.savedAt, value: new Date(doc.updatedAt).toLocaleString(ctx.locale) },
    ] }] : [{ kind: "alert", variant: "destructive", message: t.invalid }], actions };
  });
}

export async function bookmarksView(ctx: JumperContext, bookId?: string, cursors: (string | undefined)[] = [undefined], query?: string): Promise<PluginView> {
  const t = bookmarkCopy(ctx.locale);
  const filter = { bookId, limit: 40, cursor: cursors[cursors.length - 1], ...(query ? { query } : {}) };
  return liveBookmarks(ctx, { kind: "page", collection: BOOKMARKS, filter },
    async () => ({ kind: "page", page: await bookmarkCollection(ctx).page(filter) }), async result => {
  if (result.kind !== "page") throw Error("Expected bookmark page");
  const page = result.page;
  if (page.status === "stale-cursor") return message(ctx, t.stale, () => bookmarksView(ctx, bookId, [undefined], query));
  const session = await ctx.domains.reading.queries.session();
  const ready = session.status === "ready" && session.location && session.bookId;
  const next = async (values: (string | undefined)[]) => ({ view: await bookmarksView(ctx, bookId, values, query), navigation: "replace" as const });
  const actions: PluginAction[] = [];
  if (ready) {
    actions.push({ id: "save-location", label: t.current, icon: "plus", variant: "solid", priority: "primary", run: async () => ({ view: await saveBookmarkView(ctx, "location") }) });
    if (session.selection?.range) actions.push({ id: "save-selection", label: t.selection, icon: "highlighter", priority: "primary", run: async () => ({ view: await saveBookmarkView(ctx, "selection") }) });
  }
  actions.push({ id: "search", label: tr(ctx.locale, "searchQuery"), icon: "magnifying-glass", priority: "secondary", run: () => ({ view: {
    kind: "form", title: tr(ctx.locale, "searchQuery"), submitLabel: tr(ctx.locale, "searchQuery"),
    fields: [{ kind: "text", id: "query", label: tr(ctx.locale, "searchQuery"), value: query ?? "" }],
    onSubmit: async values => {
      const search = bookmarkSearchQuery(values.query);
      if (search === null) return { fieldErrors: { query: tr(ctx.locale, "invalidSearch") } };
      return { view: await bookmarksView(ctx, bookId, [undefined], search || undefined), navigation: "replace" };
    },
  } satisfies PluginFormView }) });
  if (query) actions.push({ id: "clear-search", label: tr(ctx.locale, "clearSearch"), icon: "arrows-clockwise", priority: "secondary", run: async () => ({ view: await bookmarksView(ctx, bookId), navigation: "replace" as const }) });
  if (bookId) actions.push({ id: "all", label: t.all, icon: "books", priority: "secondary", run: async () => ({ view: await bookmarksView(ctx, undefined, [undefined], query), navigation: "replace" as const }) });
  else if (ready) actions.push({ id: "this-book", label: t.thisBook, icon: "book-open", priority: "secondary", run: async () => ({ view: await bookmarksView(ctx, session.bookId!, [undefined], query), navigation: "replace" as const }) });
  actions.push({ id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: () => next([undefined]) });
  return { kind: "list", title: t.title, emptyText: query ? tr(ctx.locale, "noHits") : t.empty,
    items: page.items.map(doc => {
      const bookmark = parseBookmark(doc.data);
      return { id: doc.id, title: bookmark?.name ?? t.invalid, subtitle: bookmark?.bookTitle, icon: "book-bookmark",
        accessories: bookmark ? [{ kind: "tag" as const, text: bookmark.kind === "selection" ? t.range : t.location }] : [],
        onSelect: async () => ({ view: await bookmarkDetail(ctx, doc.id) }) };
    }), actions, pagination: { page: cursors.length,
      ...(cursors.length > 1 ? { onPrevious: () => next(cursors.slice(0, -1)) } : {}),
      ...(page.nextCursor ? { onNext: () => next([...cursors, page.nextCursor!]) } : {}),
    },
  } satisfies PluginListView;
  });
}
