import { expect, test } from "bun:test";
import type {
  AnnotationMutation,
  AnnotationPageQuery,
  PluginAnnotation,
  PluginBook,
  PluginEditorView,
  PluginFormView,
  PluginListView,
  PluginModule,
  PluginView,
  PluginViewResult,
  ReadingTarget,
} from "@read-aware/plugin-types";
import plugin from "../src/index";
import { detailView } from "../src/detail";
import { annotationsView } from "../src/views";
import type { AnnotationContext } from "../src/types";

const at = "2026-09-13T00:00:00.000Z";
const bookA: PluginBook = { id: "book-a", title: "Book A", format: "epub", collectionId: null, starred: false, addedAt: at, updatedAt: at };
const bookB: PluginBook = { id: "book-b", title: "Book B", format: "epub", collectionId: null, starred: false, addedAt: at, updatedAt: at };
const noteA: PluginAnnotation = { id: "note-a", kind: "note", bookId: bookA.id, body: "A note", createdAt: at, updatedAt: at, anchor: "a" };
const noteB: PluginAnnotation = { id: "note-b", kind: "note", bookId: bookB.id, body: "B note", createdAt: at, updatedAt: at, anchor: "b" };

function list(view: PluginView): PluginListView {
  if (view.kind !== "list") throw new Error("Expected list");
  return view;
}

function resultView(result: PluginViewResult): PluginView {
  if (!result?.view) throw new Error("Expected view result");
  return result.view;
}

function form(view: PluginView): PluginFormView {
  if (view.kind === "form") return view;
  const blocks = view.kind === "detail" ? view.content : view.kind === "blocks" ? view.blocks : [];
  const found = blocks.find(block => block.kind === "form");
  if (found?.kind !== "form") throw new Error("Expected form");
  return found;
}

function editor(view: PluginView): PluginEditorView {
  const blocks = view.kind === "detail" ? view.content : view.kind === "blocks" ? view.blocks : [];
  const found = blocks.find(block => block.kind === "editor");
  if (found?.kind !== "editor") throw new Error("Expected editor");
  return found;
}

function selectField(view: PluginFormView, id: string) {
  const field = view.fields.find(candidate => candidate.id === id);
  if (!field || !("options" in field)) throw new Error(`Expected select field ${id}`);
  return field;
}

function fixture(
  grant: { mode: "all" } | { mode: "current" } | { mode: "book"; bookId: string },
  currentBookId = bookA.id,
) {
  const items = grant.mode === "book" ? [noteB] : grant.mode === "current" ? [noteA] : [noteA, noteB];
  const queries: AnnotationPageQuery[] = [];
  const writes: AnnotationMutation[][] = [];
  const inspected: string[] = [];
  let libraryLists = 0;
  const snapshots = new Map(items.map(item => [item.id, { annotation: item, revision: `revision-${item.id}` }]));
  const ctx = {
    locale: "en",
    grants: { book: grant },
    domains: {
      annotations: {
        queries: {
          page: async (query: AnnotationPageQuery) => {
            queries.push(query);
            return { items, nextCursor: null, consistency: "live" as const };
          },
          inspect: async (id: string) => { inspected.push(id); return snapshots.get(id) ?? null; },
          list: async () => items,
        },
        commands: {
          applyChanges: async (changes: AnnotationMutation[]) => {
            writes.push(changes);
            return { atomic: true, changes: changes.map(change => ({ annotationId: change.annotationId, revision: "new-revision" })) };
          },
          createNote: async (input: Parameters<AnnotationContext["domains"]["annotations"]["commands"]["createNote"]>[0]) => ({ ...input, id: "created", kind: "note" as const, createdAt: at, updatedAt: at }),
          createHighlight: async (input: Parameters<AnnotationContext["domains"]["annotations"]["commands"]["createHighlight"]>[0]) => ({ ...input, id: "created", kind: "highlight" as const, createdAt: at, updatedAt: at, text: input.text, color: input.color ?? "yellow", style: input.style ?? "highlight" }),
        },
        events: { observe: () => ({ dispose() {} }), subscribe: () => ({ dispose() {} }) },
      },
      library: {
        queries: {
          books: {
            list: async () => { libraryLists += 1; return [bookA, bookB]; },
            get: async (id: string) => id === bookA.id ? bookA : id === bookB.id ? bookB : null,
          },
        },
      },
      reading: {
        queries: { session: async () => ({ bookId: currentBookId }) },
        commands: { goTo: async (_target: ReadingTarget) => ({ status: "completed" as const }) },
      },
    },
    services: { ui: { exportFile: async () => true } },
  } as unknown as AnnotationContext;
  const refresh = async () => ({ view: await annotationsView(ctx), navigation: "reset" as const });
  return { ctx, queries, writes, inspected, snapshots, refresh, get libraryLists() { return libraryLists; } };
}

test("all grants keep the global page and filter, while restricted grants bind one book", async () => {
  const all = fixture({ mode: "all" });
  const allView = list(await annotationsView(all.ctx, { bookId: bookA.id, previous: [] }));
  expect(all.queries).toEqual([{ bookId: bookA.id, limit: 20 }]);
  const allFilter = form(resultView(await allView.actions!.find(action => action.id === "filter")!.run()));
  const allBookField = selectField(allFilter, "bookId");
  expect(allBookField).toMatchObject({ options: [{ value: "", label: "All books" }, { value: "book-a" }, { value: "book-b" }] });
  expect(all.libraryLists).toBe(1);

  const current = fixture({ mode: "current" });
  const currentView = list(await annotationsView(current.ctx));
  expect(current.queries).toEqual([{ bookId: bookA.id, limit: 20 }]);
  const currentFilter = form(resultView(await currentView.actions!.find(action => action.id === "filter")!.run()));
  const currentBookField = selectField(currentFilter, "bookId");
  expect(currentBookField).toMatchObject({ value: bookA.id, options: [{ value: bookA.id, label: "Book A" }] });
  expect(currentBookField?.options.some(option => option.value === "")).toBe(false);
  expect(current.libraryLists).toBe(0);

  const fixed = fixture({ mode: "book", bookId: bookB.id });
  const fixedView = list(await annotationsView(fixed.ctx));
  expect(fixed.queries).toEqual([{ bookId: bookB.id, limit: 20 }]);
  const fixedFilter = form(resultView(await fixedView.actions!.find(action => action.id === "filter")!.run()));
  expect(selectField(fixedFilter, "bookId")).toMatchObject({ value: bookB.id, options: [{ value: bookB.id, label: "Book B" }] });
  expect(fixed.libraryLists).toBe(0);
});

test("restricted detail and editor stay on the granted book and write with the existing CAS revision", async () => {
  const f = fixture({ mode: "book", bookId: bookB.id }, bookA.id);
  const view = list(await annotationsView(f.ctx));
  const detail = await view.items[0]!.onSelect!();
  const edit = editor(resultView(detail));
  await edit.onSave("Edited B", edit.revision);
  expect(f.writes).toEqual([[{ op: "updateNote", annotationId: noteB.id, expectedRevision: "revision-note-b", body: "Edited B" }]]);

  const denied = await detailView(f.ctx, noteA.id, f.refresh, bookA.id);
  expect(denied).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "plugin/object-access-denied" }] });
  expect(f.inspected).toEqual([noteB.id]);
});

test("restricted activation hides the whole-library shelf contribution and never falls back to an empty global page", async () => {
  const registrations = async (grant: Parameters<typeof fixture>[0]) => {
    const f = fixture(grant);
    const headers: { surface: string }[] = [];
    f.ctx.contributions = {
      selectionActions: { register: () => ({ dispose() {} }) },
      headerActions: { register: (action: { surface: string }) => { headers.push(action); return { dispose() {} }; } },
      commands: { register: () => ({ dispose() {} }) },
    } as unknown as AnnotationContext["contributions"];
    await (plugin as PluginModule).activate(f.ctx);
    return { f, headers };
  };

  expect((await registrations({ mode: "all" })).headers.map(header => header.surface)).toEqual(["shelf", "reader"]);
  expect((await registrations({ mode: "current" })).headers.map(header => header.surface)).toEqual(["reader"]);
  expect((await registrations({ mode: "book", bookId: bookB.id })).headers.map(header => header.surface)).toEqual(["reader"]);

  const f = fixture({ mode: "book", bookId: bookB.id });
  const denied = await annotationsView(f.ctx, { bookId: bookA.id, previous: [] });
  expect(denied).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "plugin/object-access-denied" }] });
  expect(f.queries).toEqual([]);
});

test("current grant with no active book reports an access error instead of a successful empty list", async () => {
  const f = fixture({ mode: "current" }, "");
  const view = await annotationsView(f.ctx);
  expect(view).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "plugin/object-access-denied" }] });
  expect(f.queries).toEqual([]);
});
