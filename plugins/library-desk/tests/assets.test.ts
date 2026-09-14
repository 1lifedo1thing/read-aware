import { importTask } from "../src/import-task";
import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginLibraryDomain, PluginListView, PluginModule, PluginView, PluginViewContent } from "@read-aware/plugin-types";
import { bookAssets } from "../src/book-assets";
import { importBook } from "../src/import-book";

function fixture() {
  const book = { id: "a", title: "Alpha", author: "Author", format: "epub" as const, starred: false, collectionId: null, addedAt: "2026-09-11", updatedAt: "2026-09-11" };
  const resource = { id: "owned", name: "Alpha.epub", size: 42, mimeType: "application/epub+zip", state: "ready" as const, source: "picked" as const, expiresAt: 99 };
  let snapshot: Awaited<ReturnType<PluginLibraryDomain["queries"]["books"]["getEnrichment"]>> = {
    bookId: book.id, cover: { status: "ready", local: true }, supported: true, sourceLocal: true, metadataPending: false,
    job: { phase: "idle", startedAt: null, finishedAt: null, errorCode: null, reason: null },
  };
  const calls: unknown[][] = [], updates: PluginViewContent[] = [];
  let handler: Parameters<PluginLibraryDomain["events"]["observeEnrichment"]>[1] | undefined;
  const resources = {
    assets: { get: async () => null },
    pick: async (options: unknown) => { calls.push(["pick", options]); return { cancelled: false, resources: [resource] }; },
    openBook: async (id: string) => { calls.push(["book", id]); return resource; },
    openCover: async (id: string) => { calls.push(["cover", id]); return resource; },
    save: async (id: string, name?: string) => { calls.push(["save", id, name]); return { saved: true }; },
    release: async (id: string) => { calls.push(["release", id]); },
  };
  const queries = {
    list: async () => [book], get: async (): Promise<typeof book | null> => book, getEnrichment: async () => snapshot,
    listFormats: async () => [{ format: "epub", extensions: ["epub"], mimeTypes: ["application/epub+zip"] }],
    inspectResource: async (id: string) => { calls.push(["inspect", id]); return {
      status: "parsed", coverage: "initialization", formatHint: "epub", sectionCount: 2, errorCode: null,
    }; },
  };
  const write = {
    startImport: async (input: { resourceId: string }) => ({ taskId: "import", sourceName: "Alpha.epub", phase: "completed", revision: 1,
      createdAt: "now", updatedAt: "now", cancellable: false, cancelRequested: false, errorCode: null, receipt: await write.importResource(input.resourceId) }),
    importResource: async (id: string) => { calls.push(["import", id]); return { status: "imported", book }; },
    retryEnrichment: async (id: string) => { calls.push(["retry", id]); snapshot = { ...snapshot, job: { ...snapshot.job, phase: "queued" } }; return { status: "queued", snapshot }; },
  };
  const clipboard = { writeImage: async (id: string) => { calls.push(["copy", id]); return { copied: true, width: 4, height: 6 }; } };
  const ctx = { withEvent: () => ctx, locale: "en", domains: { library: { queries: { books: queries }, commands: { books: write }, events: {
    observeEnrichment: (_id: string, next: typeof handler) => { handler = next; return { dispose() { calls.push(["dispose"]); } }; },
  } } }, services: { resources, clipboard, ui: { publishView: async (_channel: unknown, update: { view: PluginViewContent }) => {
    updates.push(update.view); return { status: "applied" };
  } } } } as unknown as PluginContext;
  return { ctx, book, resource, resources, queries, write, clipboard, calls, updates,
    setSnapshot(next: typeof snapshot) { snapshot = next; }, get snapshot() { return snapshot; },
    emit(event: Parameters<NonNullable<typeof handler>>[0]) { return handler!(event, { reaction: { id: "fixture", status: "ready" } } as Parameters<NonNullable<typeof handler>>[1]); },
  };
}
const action = (view: PluginViewContent, id: string) => (view as PluginDetailView).actions!.find(item => item.id === id)!;

test("refresh resolves current metadata and retires actions when the selected book was removed", async () => {
  const f = fixture(), root = await bookAssets(f.ctx, f.book);
  f.queries.get = async () => ({ ...f.book, title: "Renamed after opening" });
  const refreshed = (await action(root, "refresh").run())!.view!;
  expect(refreshed.title).toBe("Renamed after opening");
  const preview = (await action(refreshed, "cover").run())!.view! as PluginView & PluginDetailView;
  expect(preview.content[0]).toMatchObject({ kind: "image", alt: "Renamed after opening" });
  await preview.onClose!({ reason: "closed" });
  f.queries.get = async () => null;
  const removed = (await action(refreshed, "refresh").run())!.view! as PluginView & PluginDetailView;
  expect(removed.actions).toBeUndefined();
  expect(removed.live).toBeUndefined();
});

test("cover preview uses an owned reference; save cancellation is not success; copy settles before success; close releases", async () => {
  const f = fixture(), root = await bookAssets(f.ctx, f.book);
  expect(f.calls).toEqual([]);
  const preview = (await action(root, "cover").run())!.view!;
  expect((preview as PluginDetailView).content[0]).toMatchObject({ kind: "image", resourceId: "owned", alt: "Alpha", aspectRatio: 2 / 3 });
  f.resources.save = async () => ({ saved: false });
  expect(await action(preview, "save-cover").run()).toBeNull();
  expect(await action(preview, "copy-cover").run()).toEqual({ toast: "Cover copied" });
  expect(f.calls).toEqual([["cover", "a"], ["copy", "owned"]]);
  await preview.onClose!({ reason: "back" });
  expect(f.calls[f.calls.length - 1]).toEqual(["release", "owned"]);
});

test("copy failure propagates without claiming success or destroying the preview", async () => {
  const f = fixture();
  f.clipboard.writeImage = async () => { throw Object.assign(Error("private detail"), { code: "fs/permission" }); };
  const preview = (await action(await bookAssets(f.ctx, f.book), "cover").run())!.view!;
  await expect(action(preview, "copy-cover").run()).rejects.toMatchObject({ code: "fs/permission" });
  expect(f.calls.some(call => call[0] === "release")).toBe(false);
  await preview.onClose!({ reason: "closed" });
});

test("original exports acquire fresh references and release on save, cancellation and failure", async () => {
  const f = fixture(), root = await bookAssets(f.ctx, f.book);
  expect(await action(root, "export").run()).toEqual({ toast: "Saved" });
  expect(f.calls).toEqual([["book", "a"], ["save", "owned", "Alpha.epub"], ["release", "owned"]]);
  f.resources.save = async () => ({ saved: false });
  expect(await action(root, "export").run()).toBeNull();
  f.resources.save = async () => { throw Error("save failed"); };
  await expect(action(root, "export").run()).rejects.toThrow("save failed");
  expect(f.calls.filter(call => call[0] === "release")).toHaveLength(3);
});

test("enrichment observation preserves failure, disables stale actions, recovers and retires", async () => {
  const f = fixture(), root = await bookAssets(f.ctx, f.book), subscription = await root.live!.subscribe({ id: "frame" });
  await f.emit({ status: "error", errorCode: "db/locked" });
  const failed = f.updates[f.updates.length - 1] as PluginDetailView;
  expect(failed.content[0]).toEqual({ kind: "group", blocks: [{ kind: "error", code: "db/locked" }] });
  expect(failed.actions!.map(a => a.id)).toEqual(["refresh"]);
  await f.emit({ status: "ready", snapshot: f.snapshot });
  expect(action(f.updates[f.updates.length - 1], "cover")).toBeDefined();
  subscription.dispose();
  await f.emit({ status: "error", errorCode: "db/locked" });
  expect(f.updates).toHaveLength(2);
  expect(f.calls[f.calls.length - 1]).toEqual(["dispose"]);
});

test("local missing metadata can request enrichment, but queued does not mean completed", async () => {
  const f = fixture(); f.setSnapshot({ ...f.snapshot, metadataPending: true, cover: { status: "unchecked", local: false } });
  const root = await bookAssets(f.ctx, f.book);
  expect(action(root, "cover")).toBeUndefined();
  const next = (await action(root, "enrich").run())!.view! as PluginDetailView;
  expect(f.calls).toEqual([["retry", "a"]]);
  expect(action(next, "enrich")).toBeUndefined();
  expect(JSON.stringify(next.content)).toContain("Queued");
});

test("import inspects first, requires an explicit action, shows a commit receipt and transfers the picked reference to the task view", async () => {
  const f = fixture(), review = (await importBook(f.ctx))!.view!;
  expect(f.calls).toEqual([["pick", { multiple: false, extensions: ["epub"] }], ["inspect", "owned"]]);
  const imported = await action(review, "import").run();
  expect(imported!.navigation).toBe("replace");
  expect((imported!.view as PluginDetailView).content).toEqual([{ kind: "text", text: "Imported" }]);
  await review.onClose!({ reason: "replaced" });
  expect(f.calls.some(call => call[0] === "release")).toBe(false);
  await imported!.view!.onClose!({ reason: "closed" });
  expect(f.calls.slice(-2)).toEqual([["import", "owned"], ["release", "owned"]]);
  expect((await action(imported!.view!, "details").run())!.view!.title).toBe("Alpha");
});

test("cancelled picker performs no inspection or import", async () => {
  const f = fixture(); f.resources.pick = async () => ({ cancelled: true, resources: [] });
  expect(await importBook(f.ctx)).toBeNull(); expect(f.calls).toEqual([]);
});

test("associated opening preserves decline and failure, releases originals, and reports only OS dispatch", async () => {
  const f = fixture(); let dispatched = 0;
  f.ctx.services.resources.openAssociated = async id => { expect(id).toBe("owned"); dispatched++; return { opened: false }; };
  const view = await bookAssets(f.ctx, f.book);
  expect(await action(view, "open-original").run()).toBeNull();
  expect(f.calls[f.calls.length - 1]).toEqual(["release", "owned"]);
  f.ctx.services.resources.openAssociated = async () => ({ opened: true });
  expect(await action(view, "open-original").run()).toEqual({ toast: "Open request sent to the system" });
  f.ctx.services.resources.openAssociated = async () => { throw Error("association failed"); };
  await expect(action(view, "open-original").run()).rejects.toThrow("association failed");
  expect(f.calls.filter(call => call[0] === "release")).toHaveLength(3);
  expect(dispatched).toBe(1);
});

test("encrypted inspection shows only a safe error and closing releases; parser rejection also releases", async () => {
  const f = fixture();
  f.ctx.domains.library!.queries.books.inspectResource = async () => ({ status: "encrypted", coverage: "initialization", formatHint: "epub", sectionCount: null, errorCode: "book/encrypted" });
  const review = (await importBook(f.ctx))!.view! as PluginView & PluginDetailView;
  expect(review.actions).toEqual([]);
  expect(review.content[1]).toEqual({ kind: "error", code: "book/encrypted" });
  await review.onClose!({ reason: "closed" });
  f.ctx.domains.library!.queries.books.inspectResource = async () => { throw Error("parser failed"); };
  await expect(importBook(f.ctx)).rejects.toThrow("parser failed");
  expect(f.calls.filter(call => call[0] === "release")).toHaveLength(2);
});

test("duplicate import is not labelled newly imported, and failed import retains the review resource for retry", async () => {
  const f = fixture(); f.write.importResource = async () => ({ status: "duplicate", book: f.book });
  const review = (await importBook(f.ctx))!.view!;
  expect(((await action(review, "import").run())!.view as PluginDetailView).content).toEqual([{ kind: "text", text: "Already in library" }]);
  f.write.importResource = async () => { throw Error("write failed"); };
  await expect(action(review, "import").run()).rejects.toThrow("write failed");
  expect(f.calls.some(call => call[0] === "release")).toBe(false);
  await review.onClose!({ reason: "closed" });
});

test("compiled header entry reaches selected-book assets and the import review through public APIs", async () => {
  const compiled = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  const f = fixture();
  let header: Parameters<PluginContext["contributions"]["headerActions"]["register"]>[0] | undefined;
  f.ctx.contributions = { agentTools: { register() {} }, commands: { register() {} }, headerActions: { register(value: typeof header) { header = value; } } } as unknown as PluginContext["contributions"];
  await compiled.activate(f.ctx);
  const root = await header!.view!({}) as PluginView & PluginListView;
  const dropped = (await root.fileDrop!.onDrop([f.resource]))!.view!;
  expect(action(dropped, "import")).toBeDefined();
  expect(f.calls.some(call => call[0] === "import")).toBe(false);
  await dropped.onClose!({ reason: "closed" });
  const subscription = await root.live!.subscribe({ id: "compiled" });
  await (f.updates[f.updates.length - 1] as PluginListView).items[0].onSelect!();
  const selected = f.updates[f.updates.length - 1];
  const details = (await action(selected, "details").run())!.view!;
  expect(action(details, "cover")).toBeDefined();
  const review = (await action(selected, "import").run())!.view!;
  expect(action(review, "import")).toBeDefined();
  await review.onClose!({ reason: "closed" });
  subscription.dispose();
});


test("import task view publishes progress through reactions and retires cancellation after staging", async () => {
  const f = fixture();
  type Task = Awaited<ReturnType<PluginLibraryDomain["queries"]["books"]["getImportTask"]>>;
  let observer!: Parameters<PluginLibraryDomain["events"]["observeImportTask"]>[1], stopped = false, reactions = 0;
  const task: Task = { taskId: "task", sourceName: "Book.epub", phase: "queued", revision: 0, createdAt: "now", updatedAt: "now", cancellable: true, cancelRequested: false, receipt: null, errorCode: null };
  f.ctx.domains.library!.events.observeImportTask = (_id, handler, options) => { expect(options?.ruleId).toBe("import-task-live"); observer = handler; return { dispose() { stopped = true; } }; };
  f.ctx.withEvent = (() => { reactions++; return f.ctx; }) as unknown as PluginContext["withEvent"];
  const view = importTask(f.ctx, task, f.resource.id), subscription = await view.live!.subscribe({ id: "import" });
  expect(action(view, "cancel")).toBeDefined();
  await observer({ ...task, phase: "staging", cancellable: false }, { reaction: { id: "progress", status: "ready" } });
  expect(action(f.updates[0]!, "cancel")).toBeUndefined();
  await observer({ ...task, phase: "failed", errorCode: "db/locked", cancellable: false }, { reaction: { id: "failure", status: "ready" } });
  expect((f.updates[1]! as PluginDetailView).content).toContainEqual({ kind: "error", code: "db/locked" });
  await observer(task, { reaction: { id: "cycle", status: "cycle" } });
  subscription.dispose(); await observer(task, { reaction: { id: "late", status: "ready" } });
  await view.onClose!({ reason: "closed" });
  expect(reactions).toBe(2); expect(stopped).toBe(true); expect(f.calls[f.calls.length - 1]).toEqual(["release", "owned"]);
});
