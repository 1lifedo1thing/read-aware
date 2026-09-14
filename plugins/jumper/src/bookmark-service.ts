import type { PluginContext } from "@read-aware/plugin-types";
import { BOOKMARKS, parseBookmark } from "./bookmarks";

/** Service executions receive a host-fixed book grant, independently of activate(). */
export async function listBookmarkPage(ctx: PluginContext, input: unknown) {
  if (ctx.grants.book.mode !== "book") throw Object.assign(Error("A book is required"), { code: "plugin/object-access-denied" });
  const { cursor, limit = 20 } = input as { cursor?: string; limit?: number };
  const bookId = ctx.grants.book.bookId;
  const page = await ctx.services.storage.collection(BOOKMARKS).page({ bookId, limit, ...(cursor === undefined ? {} : { cursor }) });
  if (page.status === "stale-cursor") return { status: "stale-cursor", items: [], nextCursor: null };
  return { status: "ready", items: page.items.flatMap(doc => {
    const bookmark = parseBookmark(doc.data);
    // The stored index is not authority for the target inside an old document.
    return bookmark?.target.bookId === bookId ? [{ id: doc.id, name: bookmark.name, kind: bookmark.kind }] : [];
  }), nextCursor: page.nextCursor };
}
