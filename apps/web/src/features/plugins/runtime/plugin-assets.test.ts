import { expect, spyOn, test } from "bun:test";
import { ResourceOwner, type ResourceAdapter } from "../../../services/resource-owner";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { createPluginAssets } from "./plugin-assets";
import { createPluginDocuments } from "./plugin-documents";
import * as ipc from "../../../platform/ipc";

const revision = "a".repeat(32);
const metadata = { key: "cover:book", revision, name: "cover.png", mimeType: "image/png", size: 3, updatedAt: "now" };
function fixture(id: string) {
  const lifecycle = new PluginLifecycleController([]), released: string[] = [];
  let sequence = 0;
  const adapter: ResourceAdapter = {
    pick: async () => [], openBook: async () => null, openCover: async () => null,
    create: async options => ({ id: `${id}-native-${++sequence}`, size: 0, name: options.name, mimeType: options.mimeType ?? "application/octet-stream" }),
    read: async () => new Uint8Array([0, 255, 2]).buffer, append: async (_id, offset, bytes) => offset + bytes.length,
    commit: async () => {}, commitContext: async () => {}, release: async id => { released.push(id); },
    save: async () => false, imagePreview: async () => new ArrayBuffer(0), copyImage: async () => ({ copied: true, width: 1, height: 1 }),
  };
  const resources = new ResourceOwner(adapter, () => {});
  lifecycle.signal.addEventListener("abort", () => lifecycle.trackCleanup(resources.dispose()), { once: true });
  const assets = createPluginAssets(id, lifecycle, resources);
  return { lifecycle, resources, assets, released };
}
test("asset methods bind the owner, hide native IDs and reject staging, foreign handles and reserved documents", async () => {
  const a = fixture("a"), b = fixture("b");
  const calls: [string, unknown][] = [];
  const invoke = spyOn(ipc, "invoke").mockImplementation(async (command, args) => {
    calls.push([command, args]);
    if (command === "resource_store_plugin_asset") return { asset: metadata, cleanupPending: false } as never;
    if (command === "resource_open_plugin_asset") return { id: "opened-native", size: 3, name: "cover.png", mimeType: "image/png" } as never;
    return null as never;
  });
  try {
    expect(() => a.assets.get("cover:book")).toThrow(); expect(calls).toHaveLength(0);
    a.lifecycle.promote(); b.lifecycle.promote();
    const resource = await a.resources.create({ name: "cover.png", mimeType: "image/png" });
    await a.resources.append(resource.id, 0, new Uint8Array([0, 255, 2])); await a.resources.commit(resource.id);
    await expect(b.assets.store(resource.id, { key: "cover:book", expectedRevision: null })).rejects.toMatchObject({ code: "fs/not-found" });
    expect(calls).toHaveLength(0);
    const receipt = await a.assets.store(resource.id, { key: "cover:book", expectedRevision: null });
    expect(receipt.asset).toEqual(metadata);
    expect(calls[0]).toEqual(["resource_store_plugin_asset", { pluginId: "a", key: "cover:book", expectedRevision: null,
      id: "a-native-1", name: "cover.png", mimeType: "image/png" }]);
    const opened = await a.assets.open("cover:book", revision);
    expect(opened).toMatchObject({ source: "asset", state: "ready", size: 3 }); expect(opened.id).not.toBe("opened-native");
    expect(Array.from(new Uint8Array((await a.resources.read(opened.id, 0, 3)).data))).toEqual([0, 255, 2]);
    expect(() => createPluginDocuments("a", a.lifecycle).collection("_host_assets")).toThrow();
    expect(() => a.assets.get("../other")).toThrow();
    expect(() => a.assets.list({ limit: 101 })).toThrow();
    expect(() => a.assets.store(resource.id, { key: "new", expectedRevision: "bad" })).toThrow();
  } finally { a.lifecycle.stop(); b.lifecycle.stop(); await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]); invoke.mockRestore(); }
  expect(a.released).toContain("opened-native");
});

test("durable save retains its real receipt and resource lease after cancellation until physical settlement", async () => {
  const f = fixture("a"); f.lifecycle.promote();
  const resource = await f.resources.create({ name: "a" }); await f.resources.commit(resource.id);
  const native = Promise.withResolvers<unknown>();
  const invoke = spyOn(ipc, "invoke").mockImplementation(() => native.promise as never);
  try {
    const caller = new AbortController();
    const pending = f.assets.store(resource.id, { key: "one", expectedRevision: null }, { signal: caller.signal });
    await Bun.sleep(0); expect(invoke).toHaveBeenCalledTimes(1);
    caller.abort(); f.lifecycle.stop();
    let drained = false; const drain = f.lifecycle.drainStorageWrites().then(() => { drained = true; });
    await Bun.sleep(0); expect(drained).toBe(false); expect(f.released).toHaveLength(0);
    native.resolve({ asset: metadata, cleanupPending: true });
    expect(await pending).toEqual({ asset: metadata, cleanupPending: true });
    await drain; await f.lifecycle.drainCleanups(); expect(f.released).toContain("a-native-1");
    expect(() => f.assets.get("one")).toThrow();
  } finally { native.resolve(null); f.lifecycle.stop(); await f.lifecycle.drainCleanups(); invoke.mockRestore(); }
});

test("cancelled acquisition releases the late native copy and cannot publish a stale reference", async () => {
  const f = fixture("a"); f.lifecycle.promote();
  const native = Promise.withResolvers<unknown>(); const invoke = spyOn(ipc, "invoke").mockImplementation(() => native.promise as never);
  try {
    const caller = new AbortController(); const request = f.assets.open("one", revision, { signal: caller.signal }).catch(error => error);
    await Bun.sleep(0); caller.abort(Error("stopped")); expect((await request).message).toBe("stopped");
    native.resolve({ id: "late-native", size: 3, name: "a", mimeType: "text/plain" });
    await f.lifecycle.drainCleanups(); expect(f.released).toContain("late-native");
  } finally { native.resolve(null); f.lifecycle.stop(); await f.lifecycle.drainCleanups(); invoke.mockRestore(); }
});
