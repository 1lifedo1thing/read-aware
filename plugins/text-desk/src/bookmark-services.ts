import type { PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";

type ServiceRef = Parameters<PluginContext["services"]["plugins"]["callService"]>[0]["service"];
type BookmarkPage = { status: "ready" | "stale-cursor"; items: { id: string; name: string; kind: "location" | "selection" }[]; nextCursor: string | null };
function bookmarkPage(value: unknown): BookmarkPage {
  const invalid = () => Object.assign(Error("Invalid bookmark page"), { code: "plugin/service-result-invalid" });
  if (!value || typeof value !== "object") throw invalid();
  const page = value as BookmarkPage;
  if (!["ready", "stale-cursor"].includes(page.status) || !Array.isArray(page.items) || page.items.length > 20
    || page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 8192)
    || page.items.some(item => !item || typeof item.id !== "string" || item.id.length > 1024 || typeof item.name !== "string"
      || item.name.length > 120 || !["location", "selection"].includes(item.kind))) throw invalid();
  return page;
}

export async function jumperBookmarks(ctx: PluginContext, bookId: string, title: string, service?: ServiceRef, cursor?: string): Promise<PluginListView | PluginDetailView> {
  const refresh = { id: "refresh", label: tr(ctx.locale, "refresh"), run: async () => ({ view: await jumperBookmarks(ctx, bookId, title), navigation: "replace" as const }) };
  const heading = `${title} · ${tr(ctx.locale, "jumperBookmarks")}`;
  const message = (key: "jumperUnavailable" | "jumperChanged") => ({ kind: "detail" as const, title: heading,
    content: [{ kind: "text" as const, text: tr(ctx.locale, key) }], actions: [refresh] });
  const ref = service ?? (await ctx.services.plugins.listServices({ pluginId: "jumper", id: "bookmark-page" })).services.find(item => item.version === "1.0.0")?.ref;
  if (!ref) return message("jumperUnavailable");
  let page: BookmarkPage;
  try { page = bookmarkPage((await ctx.services.plugins.callService({ service: ref, bookId, input: { limit: 20, ...(cursor === undefined ? {} : { cursor }) } })).value); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "plugin/service-unavailable") return message("jumperChanged");
    throw error;
  }
  if (page.status === "stale-cursor") return message("jumperChanged");
  return { kind: "list", title: heading, items: page.items.map(item => ({ id: item.id, title: item.name, icon: "book-bookmark" })),
    emptyText: tr(ctx.locale, "jumperEmpty"), actions: [refresh, ...(page.nextCursor === null ? [] : [{ id: "next", label: tr(ctx.locale, "next"),
      run: async () => ({ view: await jumperBookmarks(ctx, bookId, title, ref, page.nextCursor!), navigation: "replace" as const }) }]) ] };
}
