import { expect, test } from "bun:test";
import type { AnnotationMutation, AnnotationPageQuery, AnnotationSnapshot, PluginAnnotation, PluginBook, PluginEditorView, PluginFormView,
  PluginListView, PluginView, PluginViewResult, ReadingTarget } from "@read-aware/plugin-types";
import plugin from "../src/index";
import { annotationsView } from "../src/views";
import { detailView } from "../src/detail";
import { reviewView, selectionView } from "../src/batch";
import { annotationExport, csvCell, exportAnnotations } from "../src/export";
import { tr } from "../src/strings";
import type { AnnotationContext } from "../src/types";
import manifest from "../manifest.json";

const at = "2026-09-09T00:00:00.000Z";
const book: PluginBook = { id: "book", title: "A book", format: "epub", collectionId: null, starred: false, addedAt: at, updatedAt: at };
const note: PluginAnnotation = { id: "note", kind: "note", bookId: "book", body: "Original note", quotedText: "Quoted text", createdAt: at, updatedAt: at, anchor: "real-cfi" };
const highlight: PluginAnnotation = { id: "highlight", kind: "highlight", bookId: "book", text: "A passage", createdAt: at, updatedAt: at, color: "yellow", style: "highlight" };
const ask: PluginAnnotation = { id: "ask", kind: "ask", bookId: "book", text: "A question?", createdAt: at };

function fixture(items: PluginAnnotation[] = [note, highlight, ask]) {
  const queries: AnnotationPageQuery[] = [];
  const writes: AnnotationMutation[][] = [];
  const inspected: string[] = [];
  const jumps: ReadingTarget[] = [];
  const snapshots = new Map(items.map(annotation => [annotation.id, { annotation, revision: `revision-${annotation.id}` }]));
  const ctx = { locale: "en", domains: {
    annotations: { queries: {
      page: async (query: AnnotationPageQuery) => { queries.push(query); return { items, nextCursor: query.cursor ? null : "opaque:cursor", consistency: "live" }; },
      inspect: async (id: string) => { inspected.push(id); return snapshots.get(id) ?? null; },
      list: () => { throw new Error("Full annotation scans forbidden"); },
    }, commands: { applyChanges: async (changes: AnnotationMutation[]) => {
      writes.push(changes);
      return { atomic: true, changes: changes.map(change => ({ annotationId: change.annotationId, revision: change.op === "remove" ? null : "new-revision" })) };
    } } },
    library: { queries: { books: { get: async () => book, list: async () => [book] } } },
    reading: { queries: { session: async () => ({ bookId: "book" }) }, commands: { goTo: async (target: ReadingTarget) => { jumps.push(target); } } },
  }, services: { session: { operationAvailability: async (query: { operation: string }) => ({ operation: query.operation, state: "unknown", conditions: [], remoteChecked: false }) }, ui: { exportFile: async () => true } } } as unknown as AnnotationContext;
  let refreshes = 0;
  const refresh = async () => { refreshes++; return { view: await annotationsView(ctx), navigation: "reset" as const }; };
  return { ctx, queries, writes, snapshots, inspected, jumps, refresh, get refreshes() { return refreshes; } };
}
function list(view: PluginView): PluginListView {
  if (view.kind !== "list") throw new Error("Expected list");
  return view;
}
function resultView(result: PluginViewResult): PluginView {
  if (!result?.view) throw new Error("Expected view result");
  return result.view;
}
function form(view: PluginView, id: string): PluginFormView {
  const blocks = view.kind === "detail" ? view.content : view.kind === "blocks" ? view.blocks : [view];
  const found = blocks.find(block => block.kind === "form" && block.fields.some(field => field.id === id));
  if (found?.kind !== "form") throw new Error(`Expected form with ${id}`);
  return found;
}
function editor(view: PluginView): PluginEditorView {
  const blocks = view.kind === "detail" ? view.content : view.kind === "blocks" ? view.blocks : [view];
  const found = blocks.find(block => block.kind === "editor");
  if (found?.kind !== "editor") throw new Error("Expected plain-text editor");
  return found;
}
function action(view: PluginView, id: string) {
  const actions = view.kind === "list" || view.kind === "detail" ? view.actions : view.kind === "blocks"
    ? view.blocks.flatMap(block => block.kind === "actions" ? block.actions : []) : [];
  const found = actions?.find(action => action.id === id);
  if (!found) throw new Error(`Expected action ${id}`);
  return found;
}

test("pagination uses bounded native queries and opaque cursors without shared mutable history", async () => {
  const f = fixture();
  const first = await annotationsView(f.ctx, { bookId: "book", kind: "note", query: "words", previous: [] });
  expect(list(first).pagination).toMatchObject({ page: 1 });
  expect(list(first).pagination?.onPrevious).toBeUndefined();
  expect(list(first).title).toBe("A book · Note · words");
  const second = resultView(await list(first).pagination!.onNext!());
  expect(f.queries).toEqual([
    { bookId: "book", kind: "note", query: "words", limit: 20 },
    { bookId: "book", kind: "note", query: "words", limit: 20, cursor: "opaque:cursor" },
  ]);
  expect(list(second).pagination).toMatchObject({ page: 2 });
  expect(list(second).pagination?.onNext).toBeUndefined();
  await list(second).pagination!.onPrevious!();
  expect(f.queries[2].cursor).toBeUndefined();
  expect(list(first).actions?.map(action => [action.id, action.priority])).toEqual([
    ["new-note", "primary"], ["filter", undefined], ["refresh", "secondary"], ["select", "secondary"], ["json", "secondary"], ["csv", "secondary"],
  ]);
  await action(second, "refresh").run();
  expect(f.queries[3].cursor).toBeUndefined();
  expect(f.queries[3].bookId).toBe("book");
});

test("filter changes reset pagination, validate book/type/query and retain exact full-text query", async () => {
  const f = fixture();
  const view = await annotationsView(f.ctx, { cursor: "opaque", previous: [undefined] });
  const filter = form(resultView(await action(view, "filter").run()), "query");
  expect(await filter.onSubmit({ query: "x".repeat(501) })).toHaveProperty("fieldErrors.query");
  expect(await filter.onSubmit({ bookId: "missing", query: "" })).toHaveProperty("fieldErrors.bookId");
  expect(await filter.onSubmit({ kind: "sql", query: "" })).toHaveProperty("fieldErrors.kind");
  const result = await filter.onSubmit({ bookId: "book", kind: "note", query: " 中文 words " });
  expect(result).toHaveProperty("navigation", "reset");
  expect(f.queries[f.queries.length - 1]).toEqual({ bookId: "book", kind: "note", query: "中文 words", limit: 20 });
});

test("load errors render a live error surface rather than an empty library", async () => {
  const f = fixture();
  f.ctx.domains.annotations.queries.page = async () => { throw new Error("locked"); };
  const view = await annotationsView(f.ctx);
  expect(view).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "annotations/observation-failed" }] });
  expect(view.live).toBeDefined();
});

test("empty pages have filters/refresh but no invalid zero-item selection or export", async () => {
  const f = fixture([]);
  const view = list(await annotationsView(f.ctx));
  expect(view.items).toEqual([]);
  expect(view.actions?.map(action => action.id)).toEqual(["new-note", "filter", "refresh"]);
  expect(view.pagination?.onNext).toBeFunction();
});

test("note writes use the inspected revision and reset to a fresh list after completion", async () => {
  const f = fixture();
  const edit = editor(await detailView(f.ctx, "note", f.refresh));
  expect(await edit.onSave("Edited\nbody", edit.revision)).toHaveProperty("navigation", "reset");
  expect(f.writes).toEqual([[{ op: "updateNote", annotationId: "note", expectedRevision: "revision-note", body: "Edited\nbody" }]]);
  expect(f.refreshes).toBe(1);
});

test("stale note edits return field errors without replacing the draft or rebasing the revision", async () => {
  const f = fixture();
  const edit = editor(await detailView(f.ctx, "note", f.refresh));
  f.ctx.domains.annotations.commands.applyChanges = async () => { throw Object.assign(new Error("private detail"), { code: "annotations/conflict" }); };
  const result = await edit.onSave("Keep my draft", edit.revision);
  expect(result).toEqual({ fieldErrors: { editor: tr("en", "conflict") } });
  expect(f.inspected).toEqual(["note"]);
  expect(f.refreshes).toBe(0);
  expect(await edit.onSave("x".repeat(100_001), edit.revision)).toHaveProperty("fieldErrors.editor");
  expect(await edit.onSave("Keep my draft", "forged-view-revision")).toEqual({ fieldErrors: { editor: tr("en", "conflict") } });
  expect(f.writes).toHaveLength(0);
  f.ctx.domains.annotations.commands.applyChanges = async () => { throw new Error("locked"); };
  await expect(edit.onSave("Draft", edit.revision)).rejects.toThrow("locked");
});

test("cancelling note editing only refreshes the desk and never writes the draft", async () => {
  const f = fixture();
  const edit = editor(await detailView(f.ctx, "note", f.refresh));
  expect(edit.onCancel).toBeDefined();
  const result = await edit.onCancel!();
  expect(result).toHaveProperty("navigation", "reset");
  expect(result?.view?.kind).toBe("list");
  expect(f.writes).toEqual([]);
  expect(f.refreshes).toBe(1);
});

test("a reload failure after commit reports a successful write and offers only a reread", async () => {
  const f = fixture();
  const refresh = async () => { throw new Error("read locked"); };
  const edit = editor(await detailView(f.ctx, "note", refresh));
  const result = await edit.onSave("Saved once", edit.revision);
  expect(result).toHaveProperty("toast", "Changes saved");
  expect(result).toHaveProperty("navigation", "reset");
  await expect(action(resultView(result), "refresh").run()).rejects.toThrow("read locked");
  expect(f.writes).toHaveLength(1);
});

test("selection inspects only selected IDs and review mutations keep those exact revisions", async () => {
  const f = fixture();
  const select = selectionView(f.ctx, [note, highlight, ask], new Map([[book.id, book]]), f.refresh);
  expect(await select.onSubmit({})).toHaveProperty("fieldErrors.item-0");
  const reviewed = resultView(await select.onSubmit({ "item-0": true, "item-2": true, "item-999": true }));
  expect(f.inspected).toEqual(["note", "ask"]);
  const remove = form(reviewed, "confirm");
  expect(await remove.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(f.writes).toHaveLength(0);
  await remove.onSubmit({ confirm: true });
  expect(f.writes).toEqual([[
    { op: "remove", annotationId: "note", expectedRevision: "revision-note", kind: "note" },
    { op: "remove", annotationId: "ask", expectedRevision: "revision-ask", kind: "ask" },
  ]]);
});

test("a deleted selected item cannot silently shrink a batch", async () => {
  const f = fixture();
  f.snapshots.delete("ask");
  const result = await selectionView(f.ctx, [note, ask], new Map(), f.refresh).onSubmit({ "item-0": true, "item-1": true });
  expect(result).toHaveProperty("fieldErrors.item-1");
  expect(f.writes).toEqual([]);
});

test("batch recolor is one atomic request, supports underline, rejects invalid choices", async () => {
  const f = fixture();
  const snapshots: AnnotationSnapshot[] = [f.snapshots.get("highlight")!, { annotation: { ...highlight, id: "second" }, revision: "second-revision" }];
  const review = await reviewView(f.ctx, snapshots, f.refresh);
  const edit = form(review, "color");
  expect(await edit.onSubmit({ color: "red", style: "highlight" })).toHaveProperty("fieldErrors.color");
  await edit.onSubmit({ color: "pink", style: "underline" });
  expect(f.writes).toEqual([[{ op: "recolorHighlight", annotationId: "highlight", expectedRevision: "revision-highlight", color: "pink", style: "underline" },
    { op: "recolorHighlight", annotationId: "second", expectedRevision: "second-revision", color: "pink", style: "underline" }]]);
  f.ctx.domains.annotations.commands.applyChanges = async () => { throw { code: "annotations/conflict" }; };
  expect(await edit.onSubmit({ color: "pink", style: "underline" })).toEqual({ fieldErrors: { color: tr("en", "conflict") } });
  expect(f.refreshes).toBe(1);
});

test("missing details stay distinguishable and navigation awaits the host completion", async () => {
  const f = fixture();
  expect((await detailView(f.ctx, "missing", f.refresh)).kind).toBe("blocks");
  const view = await detailView(f.ctx, "note", f.refresh);
  let finish!: () => void;
  f.ctx.domains.reading.commands.goTo = async target => {
    f.jumps.push(target);
    await new Promise<void>(resolve => { finish = resolve; });
    return { status: "completed", sessionId: "s", location: { bookId: "book", contentVersion: "v1", cfi: "real-cfi" } };
  };
  let closed = false;
  const pending = Promise.resolve(action(view, "open").run()).then(result => { closed = !!result?.close; });
  await Promise.resolve();
  expect(closed).toBe(false);
  finish();
  await pending;
  expect(closed).toBe(true);
  expect(f.jumps).toEqual([{ bookId: "book", cfi: "real-cfi", href: undefined }]);
});

test("JSON preserves content and has explicit bounded scope without local revision tokens", () => {
  const data = annotationExport([{ ...note, body: "=1+1\n\"中文\"" }], new Map([[book.id, book]]), "selection", "json", new Date(at));
  const parsed = JSON.parse(data);
  expect(parsed.annotations[0].body).toBe("=1+1\n\"中文\"");
  expect(parsed).toMatchObject({ schemaVersion: 1, scope: "selection", consistency: "observed-items", exportedAt: at });
  expect(data).not.toContain("revision");
});

test("CSV quotes delimiters/newlines and neutralizes spreadsheet formulas including leading controls", () => {
  expect(csvCell('normal,"text"\nnext')).toBe('"normal,""text""\nnext"');
  for (const value of ["=1+1", "+cmd", "-1", "@SUM(A1)", " \t=1", "\tvalue", "\rvalue", "\u0001@formula"]) {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  }
  const data = annotationExport([note, highlight, ask], new Map([[book.id, book]]), "page", "csv", new Date(at));
  expect(data.startsWith("\uFEFF")).toBe(true);
  expect(data).toContain('"Original note"');
  expect(data).toContain('"A book"');
});

test("cancelled native export never claims success, failed export propagates", async () => {
  const f = fixture();
  let saves = 0;
  f.ctx.services.ui.exportFile = async () => { saves++; return false; };
  expect(await exportAnnotations(f.ctx, [note], new Map(), "page", "json")).toBeUndefined();
  f.ctx.services.session.operationAvailability = async query => {
    expect(query).toMatchObject({ operation: "ui.exportFile", mimeType: "text/csv;charset=utf-8" });
    expect(query).not.toHaveProperty("content");
    return { operation: query.operation, state: "unavailable", remoteChecked: false,
      conditions: [{ kind: "provider", state: "unavailable", reason: "export-entry-unavailable", errorCode: "ui/unavailable" }] };
  };
  await expect(exportAnnotations(f.ctx, [note], new Map(), "page", "csv")).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(saves).toBe(1);
  f.ctx.services.session.operationAvailability = async query => ({ operation: query.operation, state: "unknown", remoteChecked: false, conditions: [] });
  f.ctx.services.ui.exportFile = async () => { throw new Error("disk full"); };
  await expect(exportAnnotations(f.ctx, [note], new Map(), "page", "csv")).rejects.toThrow("disk full");
});

test("locale fallback distinguishes traditional Chinese and package declares all dependencies", async () => {
  expect(tr("zh-TW", "title")).toBe("標註");
  expect(tr("zh-CN", "manage")).toBe("管理");
  expect(tr("fr-CA", "book")).toBe("Livre");
  expect(tr("unknown", "book")).toBe("Book");
  expect(manifest.requires.domains.annotations).toBe("^2.2.0");
  expect(manifest.permissions).toEqual(["annotations:write", "library:read", "reading:write"]);
  const f = fixture();
  const headers: { surface: string; presentation: string }[] = [];
  const commands: { id: string }[] = [];
  const selections: { id: string }[] = [];
  f.ctx.contributions = {
    selectionActions: { register: action => { selections.push(action); return { dispose() {} }; } },
    headerActions: { register: action => { headers.push(action as typeof headers[number]); return { dispose() {} }; } },
    commands: { register: command => { commands.push(command); return { dispose() {} }; } },
  } as AnnotationContext["contributions"];
  await plugin.activate(f.ctx);
  expect(headers.map(({ surface, presentation }) => [surface, presentation])).toEqual([["shelf", "page"], ["reader", "popup"]]);
  expect(commands.map(command => command.id)).toEqual(["open"]);
  expect(selections.map(action => action.id)).toEqual(["create-note", "create-highlight"]);
});
