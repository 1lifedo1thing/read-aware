import type { PluginContext, PluginBook, PluginView } from "@read-aware/plugin-types";
type PluginAsset = NonNullable<Awaited<ReturnType<PluginContext["services"]["resources"]["assets"]["get"]>>>;
type ResourceRef = Awaited<ReturnType<PluginContext["services"]["resources"]["stat"]>>;
import { assetStrings } from "./assets-strings";
export const coverKey = (bookId: string) => `cover:${bookId}`;
export function saveCover(ctx: PluginContext, book: PluginBook, resource: ResourceRef, expectedRevision: string | null) {
  const extension = resource.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] ?? ".bin";
  const name = `${book.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-").trim().slice(0, 180) || "cover"}${extension}`;
  return ctx.services.resources.assets.store(resource.id, { key: coverKey(book.id), expectedRevision, name });
}
export async function savedCoverView(ctx: PluginContext, asset: PluginAsset): Promise<PluginView> {
  const resources = ctx.services.resources, t = assetStrings(ctx.locale);
  const ref = await resources.assets.open(asset.key, asset.revision);
  return { kind: "detail", title: asset.name,
    content: [{ kind: "image", resourceId: ref.id, alt: asset.name, aspectRatio: 2 / 3 }, { kind: "text", text: t.privatePolicy }],
    onClose: () => resources.release(ref.id),
    actions: [
      { id: "export", label: t.save, icon: "download-simple", run: async () => (await resources.save(ref.id, asset.name)).saved ? { toast: t.saved } : null },
      { id: "delete", label: t.removePrivate, icon: "trash", variant: "danger", run: () => ({ view: {
        kind: "detail", title: t.removePrivate, content: [{ kind: "text", text: t.removePrivateReview }], actions: [
          { id: "confirm", label: t.removePrivate, variant: "danger", run: async () => {
            const result = await resources.assets.delete(asset.key, asset.revision);
            return { view: await savedCovers(ctx), navigation: "reset", toast: result.cleanupPending ? t.cleanupPending : t.removedPrivate };
          } },
        ],
      } }) },
    ],
  };
}
export async function savedCovers(ctx: PluginContext, after?: string): Promise<PluginView> {
  const t = assetStrings(ctx.locale);
  const page = await ctx.services.resources.assets.list({ limit: 50, ...(after ? { after } : {}) });
  return { kind: "list", title: t.privateCovers, emptyText: t.noPrivateCovers,
    items: page.items.filter(asset => asset.key.startsWith("cover:")).map(asset => ({ id: asset.key, title: asset.name,
      subtitle: `${asset.size} ${t.size}`, icon: "image", onSelect: async () => ({ view: await savedCoverView(ctx, asset) }) })),
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await savedCovers(ctx), navigation: "replace" }) },
      ...(page.nextAfter ? [{ id: "next", label: t.next, icon: "arrow-right", run: async () => ({ view: await savedCovers(ctx, page.nextAfter!), navigation: "replace" as const }) }] : []),
    ],
  };
}
