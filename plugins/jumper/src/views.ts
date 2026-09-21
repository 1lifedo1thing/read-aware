import type { BookTocEntry, PluginAction, PluginListItem, PluginListSearch, PluginListView, PluginView, PluginViewResult, ReadingLocation } from "@read-aware/plugin-types";
import { chapterNumber, findChapters } from "./chapters";
import { tr } from "./strings";
import type { JumperContext } from "./types";
import { textSearchView } from "./text-search";

/** Page labels are short tokens ("42", "xiv", "A-3"); anything longer is prose for the text search. */
const PAGE_LABEL = /^\S{1,16}$/u;
const PAGE_LIMIT = 10;

async function jump(ctx: JumperContext, location: ReadingLocation): Promise<PluginViewResult> {
  await ctx.domains.reading.commands.goTo(location);
  return { close: true };
}

/** Printed chapter numbers and titles first; a bare number that matches nothing falls back to TOC order. */
export function matchChapters(entries: BookTocEntry[], query: string): BookTocEntry[] {
  const printed = findChapters(entries, query, "chapter");
  if (printed.length || chapterNumber(query) === null) return printed;
  return findChapters(entries, query, "ordinal");
}

type Chapter = { entry: BookTocEntry; parent: BookTocEntry | null };

function flattenWithParents(entries: BookTocEntry[], parent: BookTocEntry | null = null): Chapter[] {
  return entries.flatMap(entry => [{ entry, parent }, ...flattenWithParents(entry.children, entry)]);
}

/** The href without its fragment: TOC entries and the reader's location both carry one. */
function section(href: string | undefined): string | null {
  return href ? href.split("#")[0]! : null;
}

/**
 * One go-to box. Empty, it lists the table of contents with the current
 * chapter marked; typed text answers with chapters, printed pages and a row
 * that runs the text search, in that order, so Enter takes the most specific
 * match. Bookmarks and history keep their own entries; only navigation lives here.
 */
export async function jumperView(ctx: JumperContext): Promise<PluginView> {
  const session = await ctx.domains.reading.queries.session();
  if (!session.bookId) return { kind: "detail", title: "Jumper", content: [{ kind: "text", text: tr(ctx.locale, "noBook"), tone: "muted" }] };
  const bookId = session.bookId;
  const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
  const chapters = flattenWithParents(toc.entries);
  const currentSection = section(session.location?.href);
  const guard = { sessionId: session.sessionId ?? undefined };

  const chapterItem = ({ entry, parent }: Chapter): PluginListItem => {
    const current = currentSection !== null && section(entry.location?.href ?? undefined) === currentSection;
    return {
      id: `chapter:${entry.id}`, title: entry.label || String(entry.ordinal), icon: "book-open",
      subtitle: entry.location ? parent?.label || undefined : tr(ctx.locale, "unavailable"),
      ...(current ? { accessories: [{ kind: "tag", text: tr(ctx.locale, "current") }] } : {}),
      ...(entry.location ? { onSelect: () => jump(ctx, entry.location!) } : {}),
    };
  };

  const pageItems = async (query: string): Promise<PluginListItem[]> => {
    if (!PAGE_LABEL.test(query)) return [];
    try {
      const page = await ctx.domains.library.queries.books.listNavigationTargets({ bookId, contentVersion: toc.contentVersion, kind: "pages", label: query, limit: PAGE_LIMIT });
      if (page.status === "absent") return [];
      return page.items.filter(item => item.location).map(item => ({
        id: `page:${item.index}`, title: tr(ctx.locale, "pageTitle").replace("{n}", item.label ?? String(item.index + 1)), icon: "file-text",
        onSelect: () => jump(ctx, item.location!),
      }));
    } catch (error) {
      // A page catalog that cannot be read only loses its rows; chapters and
      // the text search still answer the same keystroke.
      console.warn("Jumper page lookup failed", error);
      return [];
    }
  };

  const rows = async (query: string): Promise<PluginListItem[]> => {
    if (!query) return chapters.map(chapterItem);
    const byId = new Map(chapters.map(chapter => [chapter.entry.id, chapter]));
    const matched = matchChapters(toc.entries, query).map(entry => chapterItem(byId.get(entry.id) ?? { entry, parent: null }));
    const search: PluginListItem = {
      id: "search", title: tr(ctx.locale, "searchText").replace("{q}", query), icon: "magnifying-glass",
      // Smart case: capitals in the query ask for an exact-case match.
      onSelect: () => ({ view: textSearchView(ctx, { bookId, query, limit: 20, matchCase: /\p{Lu}/u.test(query) }) }),
    };
    return [...matched, ...await pageItems(query), search];
  };

  const search: PluginListSearch = {
    placeholder: tr(ctx.locale, "goTo"), autoFocus: true,
    onQuery: async query => ({ view: list(await rows(query)) }),
  };
  const actions: PluginAction[] = (["back", "forward"] as const).map(direction => ({
    id: direction, label: tr(ctx.locale, direction), icon: direction === "back" ? "arrow-left" : "arrow-right", priority: "primary",
    disabled: !(direction === "back" ? session.history.canGoBack : session.history.canGoForward),
    run: async () => { await ctx.domains.reading.commands[direction](guard); return { close: true }; },
  }));
  // A typed query always carries its text-search row, so only an empty box can be empty.
  const list = (items: PluginListItem[]): PluginListView => ({ kind: "list", items, search, actions, emptyText: tr(ctx.locale, "noToc") });
  return list(await rows(""));
}
