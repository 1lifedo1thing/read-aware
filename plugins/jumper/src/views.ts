import type { BookTocEntry, PluginAction, PluginFormView, PluginListView, PluginView, PluginViewResult, ReadingLocation } from "@read-aware/plugin-types";
import { chapterNumber, findChapters } from "./chapters";
import { tr } from "./strings";
import type { JumperContext } from "./types";
import { textSearchView } from "./text-search";
import { bookmarksView } from "./bookmark-views";
import { bookmarkCopy } from "./bookmark-strings";

async function jump(ctx: JumperContext, location: ReadingLocation) {
  await ctx.domains.reading.commands.goTo(location);
  return { close: true };
}

function chapterResults(ctx: JumperContext, entries: BookTocEntry[]): PluginListView {
  return { kind: "list", title: tr(ctx.locale, "chooseTarget"), items: entries.map(entry => ({
    id: entry.id, title: entry.label || String(entry.ordinal), icon: "book-open",
    ...(entry.location ? { onSelect: () => jump(ctx, entry.location!) } : { subtitle: tr(ctx.locale, "unavailable") }),
  })) };
}

/** Printed chapter numbers and titles first; a bare number that matches nothing falls back to TOC order. */
function matchChapters(entries: BookTocEntry[], query: string): BookTocEntry[] {
  const printed = findChapters(entries, query, "chapter");
  if (printed.length || chapterNumber(query) === null) return printed;
  return findChapters(entries, query, "ordinal");
}

async function pageJump(ctx: JumperContext, bookId: string, label: string): Promise<PluginViewResult> {
  const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
  const page = await ctx.domains.library.queries.books.listNavigationTargets({ bookId, contentVersion: toc.contentVersion, kind: "pages", label, limit: 40 });
  if (page.status === "absent") return { fieldErrors: { query: tr(ctx.locale, "pagesUnavailable") } };
  const located = page.items.filter(item => item.location);
  if (!located.length) return { fieldErrors: { query: tr(ctx.locale, "missingPage") } };
  if (located.length === 1) return jump(ctx, located[0]!.location!);
  return { view: { kind: "list", title: tr(ctx.locale, "chooseTarget"), items: located.map(item => ({
    id: String(item.index), title: `${tr(ctx.locale, "page")} ${item.label ?? item.index + 1}`, icon: "file-text",
    onSelect: () => jump(ctx, item.location!),
  })) } satisfies PluginListView };
}

export async function jumperView(ctx: JumperContext): Promise<PluginView> {
  const session = await ctx.domains.reading.queries.session();
  if (!session.bookId) return { kind: "detail", title: "Jumper", content: [{ kind: "text", text: tr(ctx.locale, "noBook"), tone: "muted" }] };
  const bookId = session.bookId;
  const form: PluginFormView = {
    kind: "form", submitLabel: tr(ctx.locale, "search"), fields: [
      { kind: "choice", id: "mode", label: tr(ctx.locale, "mode"), value: "chapter", options: [
        { value: "chapter", label: tr(ctx.locale, "chapter"), icon: "book-open" },
        { value: "text", label: tr(ctx.locale, "text"), icon: "magnifying-glass" },
        { value: "page", label: tr(ctx.locale, "page"), icon: "file-text" },
      ] },
      { kind: "text", id: "query", label: tr(ctx.locale, "queryChapter"), placeholder: tr(ctx.locale, "queryChapter"), visibleWhen: { field: "mode", equals: "chapter" } },
      { kind: "text", id: "textQuery", label: tr(ctx.locale, "queryText"), placeholder: tr(ctx.locale, "queryText"), visibleWhen: { field: "mode", equals: "text" } },
      { kind: "text", id: "pageQuery", label: tr(ctx.locale, "queryPage"), placeholder: tr(ctx.locale, "queryPage"), visibleWhen: { field: "mode", equals: "page" } },
      { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false, visibleWhen: { field: "mode", equals: "text" } },
      { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false, visibleWhen: { field: "mode", equals: "text" } },
    ],
    onSubmit: async values => {
      if (values.mode === "text") {
        const query = String(values.textQuery ?? "").trim();
        if (!query || query.length > 500) return { fieldErrors: { textQuery: tr(ctx.locale, "invalid") } };
        return { view: textSearchView(ctx, { bookId, query, limit: 20, matchCase: values.matchCase === true, wholeWords: values.wholeWords === true }) };
      }
      if (values.mode === "page") {
        const label = String(values.pageQuery ?? "").trim();
        if (!label || label.length > 300) return { fieldErrors: { pageQuery: tr(ctx.locale, "invalidPage") } };
        const result = await pageJump(ctx, bookId, label);
        return result?.fieldErrors ? { fieldErrors: { pageQuery: result.fieldErrors.query! } } : result;
      }
      const query = String(values.query ?? "").trim();
      if (!query || query.length > 500) return { fieldErrors: { query: tr(ctx.locale, "invalid") } };
      const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
      const entries = matchChapters(toc.entries, query);
      if (!entries.length) return { fieldErrors: { query: tr(ctx.locale, "missing") } };
      if (entries.length === 1) return entries[0]!.location ? jump(ctx, entries[0]!.location) : { fieldErrors: { query: tr(ctx.locale, "unavailable") } };
      return { view: chapterResults(ctx, entries) };
    },
  };
  const guard = { sessionId: session.sessionId ?? undefined };
  const actions: PluginAction[] = [
    { id: "bookmarks", label: bookmarkCopy(ctx.locale).title, icon: "book-bookmark", priority: "primary", run: async () => ({ view: await bookmarksView(ctx) }) },
  ];
  for (const direction of ["back", "forward"] as const) {
    if (!(direction === "back" ? session.history.canGoBack : session.history.canGoForward)) continue;
    actions.push({ id: direction, label: tr(ctx.locale, direction), icon: direction === "back" ? "arrow-left" : "arrow-right", priority: "secondary",
      run: async () => { await ctx.domains.reading.commands[direction](guard); return { close: true }; } });
  }
  return { kind: "blocks", title: "Jumper", blocks: [form, { kind: "actions", actions, align: "end" }] };
}
