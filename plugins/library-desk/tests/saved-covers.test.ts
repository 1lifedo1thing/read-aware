import { expect, test } from "bun:test";
import type { PluginContext, PluginModule, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { bookAssets } from "../src/book-assets";
import { savedCovers } from "../src/saved-covers";
import { registerSavedCoverTools } from "../src/saved-cover-tools";
type Asset = NonNullable<Awaited<ReturnType<PluginContext["services"]["resources"]["assets"]["get"]>>>;
type Tool = Parameters<NonNullable<PluginContext["contributions"]["agentTools"]>["register"]>[0];
const book = { id: "book", title: "Alpha", author: "A" };
function fixture() {
  const assets = new Map<string, Asset>(), tools = new Map<string, Tool>(), calls: string[] = [];
  let revision = 0, reference = 0;
  const cover = { id: "source-cover", name: "cover.png", mimeType: "image/png", size: 3, source: "cover", state: "ready", expiresAt: 100 };
  const conflict = () => { throw Object.assign(Error("changed"), { code: "plugin/asset-conflict" }); };
  const ctx = { locale: "en", domains: { library: { queries: { books: {
    get: async () => book, getEnrichment: async () => ({ cover: { local: true }, sourceLocal: false, metadataPending: false, job: { phase: "idle" } }),
  } }, commands: { books: {} }, events: {} } }, contributions: {
    commands: { register() {} }, headerActions: { register() {} }, agentTools: { register(tool: Tool) { tools.set(tool.name, tool); } },
  }, services: { resources: {
    openCover: async () => cover,
    release: async (id: string) => { calls.push(`release:${id}`); }, save: async () => ({ saved: false }),
    assets: {
      get: async (key: string) => assets.get(key) ?? null,
      list: async () => ({ items: [...assets.values()].map(a => ({ ...a })), nextAfter: null }),
      store: async (_id: string, input: { key: string; expectedRevision: string | null; name?: string }) => {
        calls.push("store"); if ((assets.get(input.key)?.revision ?? null) !== input.expectedRevision) return conflict();
        const asset = { key: input.key, revision: String(++revision).padStart(32, "0"), name: input.name ?? "cover.png", mimeType: "image/png", size: 3, updatedAt: "now" };
        assets.set(input.key, asset); return { asset: { ...asset }, cleanupPending: false };
      },
      open: async (key: string, expected: string) => {
        if (assets.get(key)?.revision !== expected) return conflict();
        const id = `reopened-${++reference}`; calls.push(`open:${id}`); return { ...cover, id, source: "asset" };
      },
      delete: async (key: string, expected: string) => {
        if (assets.get(key)?.revision !== expected) return conflict(); assets.delete(key); calls.push("delete"); return { deleted: true, cleanupPending: false };
      },
    },
  } } } as unknown as PluginContext;
  return { ctx, assets, tools, calls, cover };
}
function action(view: PluginView, id: string) {
  if (!("actions" in view)) throw Error("Expected actions");
  const found = view.actions?.find(action => action.id === id); if (!found) throw Error(`Missing ${id}`); return found;
}
function view(result: PluginViewResult): PluginView { if (!result?.view) throw Error("Missing view"); return result.view; }

test("cover UI explicitly saves a durable copy, reopens with a new lease, and confirms private-only deletion", async () => {
  const f = fixture();
  const details = await bookAssets(f.ctx, book as never);
  const preview = view(await action(details, "cover").run()); expect(f.assets.size).toBe(0);
  await action(preview, "keep-cover").run(); expect(f.assets.get("cover:book")?.name).toBe("Alpha.png");
  await preview.onClose!({ reason: "closed" }); expect(f.calls).toContain("release:source-cover");
  const list = await savedCovers(f.ctx); if (list.kind !== "list") throw Error("Expected list");
  const reopened = view(await list.items[0].onSelect!()); expect(f.calls).toContain("open:reopened-1");
  const confirmation = view(await action(reopened, "delete").run()); expect(f.assets.size).toBe(1);
  await action(confirmation, "confirm").run(); expect(f.assets.size).toBe(0); expect(f.calls).toContain("delete");
  await reopened.onClose!({ reason: "closed" }); expect(f.calls).toContain("release:reopened-1");
});

test("stale save confirmation rejects without overwriting a newer saved copy", async () => {
  const f = fixture(), details = await bookAssets(f.ctx, book as never);
  const preview = view(await action(details, "cover").run());
  await f.ctx.services.resources.assets.store(f.cover.id, { key: "cover:book", expectedRevision: null, name: "newer.png" });
  await expect(action(preview, "keep-cover").run()).rejects.toMatchObject({ code: "plugin/asset-conflict" });
  expect(f.assets.get("cover:book")?.name).toBe("newer.png"); await preview.onClose!({ reason: "closed" });
});

test("plugin tools require approval for saved-copy mutations and release temporary references on export cancellation", async () => {
  const f = fixture(); registerSavedCoverTools(f.ctx);
  expect(f.tools.get("save_cover_asset")?.approval).toBe("required");
  expect(f.tools.get("manage_saved_cover")?.approval).toBe("required");
  const save = f.tools.get("save_cover_asset")!;
  await save.execute({ bookId: "book", expectedRevision: null }); expect(f.calls).toContain("release:source-cover");
  const listed = await f.tools.get("list_saved_covers")!.execute({}); expect(JSON.stringify(listed)).toContain("Alpha.png");
  expect(JSON.stringify(listed)).not.toContain("source-cover");
  const asset = f.assets.get("cover:book")!;
  expect(await f.tools.get("manage_saved_cover")!.execute({ key: asset.key, expectedRevision: asset.revision, action: "export" })).toEqual({ saved: false });
  expect(f.calls).toContain("release:reopened-1");
  await expect(save.execute({ bookId: "book", expectedRevision: null })).rejects.toMatchObject({ code: "plugin/asset-conflict" });
  expect(f.calls.filter(call => call === "release:source-cover")).toHaveLength(2);
});

test("compiled Library Desk registers and executes the three public asset tools", async () => {
  const f = fixture(); const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx); expect([...f.tools.keys()].sort()).toEqual(["list_saved_covers", "manage_saved_cover", "save_cover_asset"]);
  await f.tools.get("save_cover_asset")!.execute({ bookId: "book", expectedRevision: null });
  expect(JSON.stringify(await f.tools.get("list_saved_covers")!.execute({}))).toContain("Alpha.png");
});
