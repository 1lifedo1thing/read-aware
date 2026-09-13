import type { PluginAction, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { selectionView } from "./batch";
import { detailView } from "./detail";
import { exportAnnotations } from "./export";
import { preview, readBooks, subtitle } from "./format";
import { tr } from "./strings";
import {
  assertAnnotationBooks,
  bookGrant,
  grantedBookId,
  grantedBooks,
  isBookAccessDenied,
  scopeErrorView,
  type DeskContext,
  type PageState,
} from "./types";
import { liveAnnotationPage } from "./live-page";
import { newNoteView } from "./creation";

async function filterView(ctx: DeskContext, state: PageState): Promise<PluginFormView | PluginView> {
  try {
    const allBooks = bookGrant(ctx).mode === "all";
    const scopedBookId = allBooks ? undefined : await grantedBookId(ctx, state.bookId);
    const books = await grantedBooks(ctx, scopedBookId);
    const kinds = ["highlight", "note", "ask"] as const;
    return { kind: "form", title: tr(ctx.locale, "filter"), submitLabel: tr(ctx.locale, "filter"), fields: [
      { kind: "select", id: "bookId", label: tr(ctx.locale, "book"), value: allBooks ? state.bookId ?? "" : scopedBookId ?? "",
        options: [
          ...(allBooks ? [{ value: "", label: tr(ctx.locale, "allBooks") }] : []),
          ...books.map(book => ({ value: book.id, label: book.title })),
        ] },
      { kind: "select", id: "kind", label: tr(ctx.locale, "kind"), value: state.kind ?? "",
        options: [{ value: "", label: tr(ctx.locale, "all") }, ...kinds.map(value => ({ value, label: tr(ctx.locale, value) }))] },
      { kind: "text", id: "query", label: tr(ctx.locale, "query"), value: state.query ?? "" },
    ], onSubmit: async (values): Promise<PluginViewResult> => {
      if (typeof values.query !== "string" || values.query.length > 500) return { fieldErrors: { query: tr(ctx.locale, "invalidQuery") } };
      const bookId = String(values.bookId ?? "");
      if (!allBooks && bookId !== scopedBookId) return { fieldErrors: { bookId: tr(ctx.locale, "accessDenied") } };
      if (allBooks && bookId && !books.some(book => book.id === bookId)) return { fieldErrors: { bookId: tr(ctx.locale, "invalid") } };
      const kind = kinds.find(kind => kind === values.kind);
      if (values.kind && !kind) return { fieldErrors: { kind: tr(ctx.locale, "invalid") } };
      const nextBookId = allBooks ? (bookId || undefined) : scopedBookId;
      return { view: await deskView(ctx, { bookId: nextBookId, kind, query: values.query.trim() || undefined, previous: [] }), navigation: "reset" };
    } };
  } catch (error) {
    if (isBookAccessDenied(error)) return scopeErrorView(ctx, error);
    throw error;
  }
}

export async function deskView(ctx: DeskContext, state: PageState = { previous: [] }): Promise<PluginView> {
  const requested = structuredClone(state);
  try {
    const bookId = await grantedBookId(ctx, requested.bookId);
    state = bookId === undefined
      ? (({ bookId: _bookId, ...withoutBook }) => withoutBook)(requested)
      : { ...requested, bookId };
  } catch (error) {
    if (isBookAccessDenied(error)) return scopeErrorView(ctx, error);
    throw error;
  }
  const { previous, ...query } = state;
  return liveAnnotationPage(ctx, { ...query, limit: 20 }, async page => {
    if (page.items.length && bookGrant(ctx).mode !== "all") {
      await assertAnnotationBooks(ctx, page.items.map(item => item.bookId), "annotations.queries.page");
    }
    const books = await readBooks(ctx, page.items);
    if (state.bookId && !books.has(state.bookId)) books.set(state.bookId, await ctx.domains.library.queries.books.get(state.bookId));
    const refresh = async () => {
      const next = { ...state, cursor: undefined, previous: [] };
      if (bookGrant(ctx).mode === "current") delete next.bookId;
      return { view: await deskView(ctx, next), navigation: "reset" as const };
    };
    const actions: PluginAction[] = [
      { id: "new-note", label: tr(ctx.locale, "newNote"), icon: "note-pencil", run: async () => ({ view: await newNoteView(ctx, refresh, state.bookId) }) },
      { id: "filter", label: tr(ctx.locale, "filter"), icon: "magnifying-glass", run: async () => ({ view: await filterView(ctx, state) }) },
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh },
    ];
    if (page.items.length) actions.push(
      { id: "select", label: tr(ctx.locale, "select"), icon: "check", run: () => ({ view: selectionView(ctx, page.items, books, refresh) }) },
      ...(["json", "csv"] as const).map(format => ({ id: format, label: tr(ctx.locale, format === "json" ? "pageJson" : "pageCsv"), icon: "download-simple",
        run: () => exportAnnotations(ctx, page.items, books, "page", format) })),
    );
    if (previous.length) actions.push({ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: async () => ({
      view: await deskView(ctx, { ...state, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) }), navigation: "replace",
    }) });
    if (page.nextCursor) actions.push({ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: async () => ({
      view: await deskView(ctx, { ...state, cursor: page.nextCursor!, previous: [...previous, state.cursor] }), navigation: "replace",
    }) });
    return { kind: "list", title: [state.bookId ? books.get(state.bookId)?.title ?? tr(ctx.locale, "missingBook") : tr(ctx.locale, "allBooks"),
      state.kind ? tr(ctx.locale, state.kind) : undefined, state.query, String(previous.length + 1)].filter(Boolean).join(" · "), actions,
      emptyText: tr(ctx.locale, "empty"), items: page.items.map(item => ({ id: item.id, title: preview(item) || tr(ctx.locale, item.kind),
        subtitle: subtitle(ctx, item, books), timestamp: item.createdAt, icon: item.kind === "highlight" ? "highlighter" : item.kind === "note" ? "note-pencil" : "chat-circle-dots",
        onSelect: async () => ({ view: await detailView(ctx, item.id, refresh, item.bookId) }) })) };
  });
}
