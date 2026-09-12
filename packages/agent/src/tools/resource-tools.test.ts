import { expect, test } from "bun:test";
import { AppError, type Id, type ResourceRef, type BookImportTaskSnapshot } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildResourceTools } from "./resource-tools";

test("external resource opening delegates host confirmation in both conversation scopes without turning dispatch into rendering", async () => {
  const { deps, stores } = createInMemoryDeps(), base = deps.resources("base"), seen: unknown[] = [];
  deps.resources = (...scope) => ({ ...base, openAssociated: async id => { seen.push([scope, id]); return { opened: false }; } });
  for (const scope of [{ kind: "global", threadId: "mine" } as const, { kind: "book", bookId: "book" as Id } as const]) {
    const tool = buildResourceTools(scope, deps).find(tool => tool.name === "open_resource_external")!;
    expect(JSON.stringify(await tool.execute("open", { id: "own" }, new AbortController().signal))).toContain("false");
    expect(tool.description).toContain("NOT proof");
  }
  expect(seen).toEqual([[["global:mine", undefined], "own"], [["book:book", "book"], "own"]]);
  expect(stores.interactions).toHaveLength(0);
});

test("directory tools stay in their conversation in both scopes and preserve paging failure", async () => {
  for (const scope of [{ kind: "global", threadId: "mine" } as const, { kind: "book", bookId: "book" as Id } as const]) {
    const { deps } = createInMemoryDeps(), original = deps.resources("fixture"), seen: unknown[] = [];
    deps.resources = (...args) => { seen.push(args); return { ...original,
      pickDirectory: async () => ({ cancelled: false, directory: { id: "own", name: "Folder", expiresAt: 99 } }),
      listDirectory: async (id, query) => { expect([id, query]).toEqual(["own", { relativePath: "child", cursor: "stale" }]); throw new AppError("ui/superseded", "Listing changed"); },
      openDirectoryFile: async (id, path) => { expect([id, path]).toEqual(["own", "child/a.txt"]); return { id: "file", name: "a.txt", size: 0, source: "picked", state: "ready", expiresAt: 99, mimeType: "text/plain" }; },
      releaseDirectory: async id => { expect(id).toBe("own"); },
    }; };
    const tools = buildResourceTools(scope, deps), signal = new AbortController().signal;
    const call = (name: string, params: unknown) => tools.find(tool => tool.name === name)!.execute("test", params, signal);
    expect(JSON.stringify(await call("pick_resource_directory", {}))).toContain("Folder");
    await expect(call("list_resource_directory", { id: "own", relativePath: "child", cursor: "stale" })).rejects.toMatchObject({ code: "ui/superseded" });
    expect(JSON.stringify(await call("open_directory_resource", { id: "own", relativePath: "child/a.txt" }))).toContain("picked");
    await call("release_resource_directory", { id: "own" });
    expect(seen).toEqual(Array(4).fill(scope.kind === "global" ? ["global:mine", undefined] : ["book:book", "book"]));
  }
});

test("Agent uses thread-owned references, approves original export and cannot read book bytes", async () => {
  const { deps, stores } = createInMemoryDeps({ books: [{ id: "book" as Id, title: "Book", progressPercent: 0, status: "reading" }] });
  const original = deps.resources("test"); const scopes: unknown[] = []; let opened = 0, reads = 0;
  const ref: ResourceRef = { id: "resource", name: "book.epub", mimeType: "application/epub+zip", state: "ready", source: "book", size: 10, expiresAt: Date.now() + 10000 };
  deps.resources = (...args) => { scopes.push(args); return { ...original, openBook: async () => { opened++; return ref; }, stat: async () => ref,
    read: async () => { reads++; return { data: new ArrayBuffer(0), nextOffset: 0, eof: true }; } }; };
  const tools = buildResourceTools({ kind: "book", bookId: "book" as Id }, deps);
  const call = (name: string, params: unknown) => tools.find(t => t.name === name)!.execute("test", params, new AbortController().signal);
  await call("open_book_resource", {}); expect(opened).toBe(1);
  expect(stores.interactions[stores.interactions.length - 1]).toMatchObject({ kind: "permission", action: "access-book-file" });
  expect(scopes[0]).toEqual(["book:book", "book"]);
  await expect(call("read_resource_text", { id: "resource" })).rejects.toMatchObject({ code: "memory/forbidden" }); expect(reads).toBe(0);
  await expect(call("open_book_resource", { bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  deps.interactions.request = async () => ({ cancelled: false, optionId: "decline" });
  await call("open_book_resource", {}); expect(opened).toBe(1);
});

test("Agent cover and image tools pass only thread-scoped references and preserve unavailable/error receipts", async () => {
  const { deps } = createInMemoryDeps(), original = deps.resources("test");
  let covers = 0; const calls: unknown[] = [];
  deps.resources = (...scope) => { calls.push(scope); return { ...original,
    openCover: async id => { expect(id).toBe("book"); covers++; return null; },
    copyImage: async id => { expect(id).toBe("own-image"); return { copied: true, width: 2, height: 3 }; },
  }; };
  const tools = buildResourceTools({ kind: "book", bookId: "book" as Id }, deps);
  const call = (name: string, params: unknown) => tools.find(t => t.name === name)!.execute("test", params, new AbortController().signal);
  expect(JSON.stringify(await call("open_book_cover", {}))).toContain("null");
  await expect(call("open_book_cover", { bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  expect(covers).toBe(1);
  expect(JSON.stringify(await call("copy_resource_image", { id: "own-image" }))).toContain("copied");
  expect(calls).toEqual([["book:book", "book"], ["book:book", "book"]]);
  deps.resources = () => ({ ...original, openCover: async () => { throw new Error("load failed"); } });
  await expect(call("open_book_cover", {})).rejects.toThrow("load failed");
});

test("UTF-8 paging returns byte offsets without losing split codepoints and rejects binary", async () => {
  const { deps } = createInMemoryDeps(), original = deps.resources("test");
  const bytes = new TextEncoder().encode("abc中文");
  deps.resources = () => ({ ...original,
    stat: async id => ({ id, name: "test.txt", mimeType: "text/plain", source: "picked", state: "ready", size: bytes.length, expiresAt: 999999 }),
    read: async (_id, offset, length) => { const data = new Uint8Array(bytes.slice(offset, offset + length)).buffer; return { data, nextOffset: offset + data.byteLength, eof: offset + data.byteLength === bytes.length }; },
  });
  const tool = buildResourceTools({ kind: "global", threadId: "thread" }, deps).find(t => t.name === "read_resource_text")!;
  const first = JSON.stringify(await tool.execute("test", { id: "r", length: 4 }, new AbortController().signal));
  expect(first).toContain("abc"); expect(first).toContain('nextOffset\\":3');
  const second = JSON.stringify(await tool.execute("test", { id: "r", offset: 3 }, new AbortController().signal));
  expect(second).toContain("中文");
  bytes[0] = 0;
  await expect(tool.execute("test", { id: "r" }, new AbortController().signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
});

test("inspection uses the global conversation resource owner and does not import or request mutation approval", async () => {
  const { deps, stores } = createInMemoryDeps(), signal = new AbortController().signal;
  deps.library.inspectResource = async (thread, id, received) => {
    expect([thread, id, received]).toEqual(["global:thread", "selected", signal]);
    return { formatHint: "epub", status: "encrypted", coverage: "initialization", sectionCount: null, errorCode: "book/unsupported-encryption" };
  };
  const tools = buildResourceTools({ kind: "global", threadId: "thread" }, deps);
  const tool = tools.find(t => t.name === "inspect_resource_book")!;
  expect(buildResourceTools({ kind: "book", bookId: "book" as Id }, deps).some(t => t.name === tool.name)).toBe(false);
  expect(JSON.stringify(await tool.execute("inspect", { id: "selected" }, signal))).toContain("encrypted");
  expect(stores.interactions).toHaveLength(0);
});

test("resource import is global-only, requires approval and reports task admission separately from completion", async () => {
  const { deps, stores } = createInMemoryDeps(); let imported = 0;
  const snapshot: BookImportTaskSnapshot = { taskId: "task", sourceName: "fixture.txt", phase: "queued", revision: 0,
    createdAt: "2026-09-12", updatedAt: "2026-09-12", cancellable: true, cancelRequested: false, receipt: null, errorCode: null };
  deps.library.startImportResource = async (thread, id) => {
    expect([thread, id]).toEqual(["global:thread", "selected"]); imported++;
    return structuredClone(snapshot);
  };
  const tools = buildResourceTools({ kind: "global", threadId: "thread" }, deps), tool = tools.find(t => t.name === "import_resource_book")!;
  expect(buildResourceTools({ kind: "book", bookId: "book" as Id }, deps).some(t => t.name === tool.name)).toBe(false);
  const admitted = JSON.stringify(await tool.execute("import", { id: "selected" }, new AbortController().signal));
  expect(admitted).toContain("queued"); expect(admitted).not.toContain("duplicate");
  expect(stores.interactions[0]).toMatchObject({ action: "import-resource", subject: "fixture.txt" });
  const waiter = new AbortController();
  deps.library.getImportTask = async (thread, id, waitMs, signal) => {
    expect([thread, id, waitMs]).toEqual(["global:thread", "task", 5000]); expect(signal).toBe(waiter.signal); return structuredClone(snapshot);
  };
  snapshot.phase = "completed"; snapshot.cancellable = false;
  snapshot.receipt = { status: "duplicate", book: { id: "book" as Id, title: "Existing", format: "txt", starred: false,
    collectionId: null, addedAt: "2026-09-10", updatedAt: "2026-09-10" } };
  const inspect = tools.find(t => t.name === "get_book_import_tasks")!;
  expect(JSON.stringify(await inspect.execute("inspect", { taskId: "task", waitMs: 5000 }, waiter.signal))).toContain("duplicate");
  deps.interactions.request = async () => ({ cancelled: false, optionId: "decline" });
  await tool.execute("decline", { id: "selected" }, new AbortController().signal); expect(imported).toBe(1);
});

test("import task inspection and cancellation stay in their conversation and propagate missing-handle failures", async () => {
  const { deps } = createInMemoryDeps(), calls: unknown[] = [], signal = new AbortController().signal;
  deps.library.listImportTasks = async thread => { calls.push(thread); return []; };
  deps.library.cancelImportTask = async (thread, id) => { calls.push([thread, id]); throw new AppError("ui/invalid-target", "Missing task"); };
  const tools = buildResourceTools({ kind: "global", threadId: "mine" }, deps);
  await tools.find(tool => tool.name === "get_book_import_tasks")!.execute("list", {}, signal);
  await expect(tools.find(tool => tool.name === "get_book_import_tasks")!.execute("invalid-wait", { waitMs: 10 }, signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(tools.find(tool => tool.name === "cancel_book_import_task")!.execute("cancel", { taskId: "unknown" }, signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
  expect(calls).toEqual(["global:mine", ["global:mine", "unknown"]]);
  const bookTools = buildResourceTools({ kind: "book", bookId: "book" as Id }, deps);
  expect(bookTools.some(tool => ["get_book_import_tasks", "cancel_book_import_task"].includes(tool.name))).toBe(false);
});
