import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView, PluginView } from "@read-aware/plugin-types";
import { browseDirectory } from "../src/directory";

test("folder discovery uses relative handles, defers import until confirmation, and releases each owner", async () => {
  const calls: unknown[] = [];
  const ctx = { locale: "zh-CN", services: { resources: {
    pickDirectory: async () => ({ cancelled: false, directory: { id: "dir", name: "Books", expiresAt: 99 } }),
    listDirectory: async (id: string, query: { relativePath: string }) => {
      calls.push(["list", id, query.relativePath]);
      return { entries: query.relativePath ? [{ name: "a.epub", relativePath: "child/a.epub", kind: "file", size: 5 }]
        : [{ name: "child", relativePath: "child", kind: "directory", size: null }], nextCursor: null, omittedCount: 0 };
    },
    openDirectoryFile: async (id: string, path: string) => { calls.push(["open", id, path]); return { id: "file", name: "a.epub", size: 5 }; },
    releaseDirectory: async (id: string) => { calls.push(["release-dir", id]); },
    release: async (id: string) => { calls.push(["release-file", id]); },
  } }, domains: { library: { queries: { books: {
    inspectResource: async (id: string) => { calls.push(["inspect", id]); return { formatHint: "epub", status: "parsed", sectionCount: 2 }; },
  } }, commands: { books: { importResource: async (id: string) => { calls.push(["import", id]); return { status: "imported", book: { title: "Book" } }; } } } } } } as unknown as PluginContext;
  const root = (await browseDirectory(ctx))!.view as PluginListView & PluginView;
  const child = (await root.items[0]!.onSelect!())!.view as PluginListView & PluginView;
  expect(child.onClose).toBeUndefined();
  const inspection = (await child.items[0]!.onSelect!())!.view as PluginDetailView & PluginView;
  expect(calls).toEqual([["list", "dir", ""], ["list", "dir", "child"], ["open", "dir", "child/a.epub"], ["inspect", "file"]]);
  await inspection.actions![0]!.run();
  expect(calls[calls.length - 1]).toEqual(["import", "file"]);
  await inspection.onClose!({ reason: "back" }); await root.onClose!({ reason: "back" });
  expect(calls.slice(-2)).toEqual([["release-file", "file"], ["release-dir", "dir"]]);
});

test("failed initial browsing releases the grant; a cancelled picker creates no view", async () => {
  let released = 0;
  const resources = {
    pickDirectory: async () => ({ directory: { id: "dir", name: "Folder" } } as { directory: { id: string; name: string } | null }),
    listDirectory: async () => { throw Error("unreadable"); }, releaseDirectory: async () => { released++; },
  };
  const ctx = { locale: "en", services: { resources } } as unknown as PluginContext;
  await expect(browseDirectory(ctx)).rejects.toThrow("unreadable"); expect(released).toBe(1);
  resources.pickDirectory = async () => ({ directory: null });
  expect(await browseDirectory(ctx)).toBeNull(); expect(released).toBe(1);
});
