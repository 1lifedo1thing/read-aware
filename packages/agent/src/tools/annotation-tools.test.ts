import { expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { AppError, type AnnotationItem, type Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAnnotationTools } from "./annotation-tools";
import { buildThreadTools } from "./library-tools";

const bookId = "book" as Id;
const timestamp = "2026-09-09T00:00:00Z";
const note: AnnotationItem = { kind: "note", id: "note" as Id, bookId, body: "Original", createdAt: timestamp, updatedAt: timestamp };
const ask: AnnotationItem = { kind: "ask", id: "ask" as Id, bookId, text: "A real question", createdAt: timestamp };
function fixture() {
  const { deps, stores } = createInMemoryDeps({ books: [{ id: bookId, title: "Book" }], annotations: [note, ask, { ...note, id: "other-note" as Id, bookId: "other" as Id }] });
  const scope = { kind: "book" as const, bookId };
  const tools = [...buildAnnotationTools(scope, deps), ...buildThreadTools(scope, deps)];
  return { deps, stores, tool: (name: string) => tools.find(tool => tool.name === name)! };
}
const parsed = (result: AgentToolResult<unknown>) => {
  if (result.content[0]?.type !== "text") throw new Error("Expected text result");
  return JSON.parse(result.content[0].text);
};

test("Agent creates an underline through the canonical highlight command", async () => {
  const { deps, tool } = fixture();
  const result = parsed(await tool("create_annotation").execute("create", { kind: "highlight", text: "Quoted passage", style: "underline", color: "blue" }));
  expect(result).toMatchObject({ kind: "highlight", style: "underline", color: "blue", bookId });
  expect(await deps.annotations.getAnnotation(result.id)).toMatchObject({ style: "underline" });
  expect(parsed(await tool("create_annotation").execute("create", { kind: "highlight", text: "Default" }))).toMatchObject({ style: "highlight" });
});

test("create_annotation preserves a dictated note body, including terminal punctuation", async () => {
  const { deps, tool } = fixture();
  const body = "核对作者的问题措辞。";
  const result = parsed(await tool("create_annotation").execute("create", { kind: "note", body }));
  expect(result).toMatchObject({ kind: "note", body, bookId });
  expect(await deps.annotations.getAnnotation(result.id)).toMatchObject({ kind: "note", body });
});

test("exact annotation reads preserve book/type filters without scanning the list", async () => {
  const { deps, tool } = fixture();
  deps.annotations.listAnnotations = async () => { throw new Error("Unexpected full list"); };
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "note" })).items).toEqual([note]);
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "missing" })).items).toEqual([]);
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "note", kind: "ask" })).items).toEqual([]);
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "other-note" })).items).toEqual([]);
  // Existing annotation tools allow explicit cross-book retrieval; scope is a default, not a new permission.
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "other-note", bookId: "other" })).items).toHaveLength(1);
  await expect(tool("get_annotations").execute("get", { annotationId: "note", query: "Original" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
});

test("type filters reach the annotations port", async () => {
  const { tool } = fixture();
  expect(parsed(await tool("get_annotations").execute("get", { kind: "ask" })).items).toEqual([ask]);
});

test("Agent annotation browsing is paginated and cursor filters cannot be changed", async () => {
  const { deps, tool } = fixture();
  deps.annotations.listAnnotations = async () => { throw new Error("Must not scan the legacy list"); };
  const first = parsed(await tool("get_annotations").execute("get", { limit: 1 }));
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBeString();
  const next = parsed(await tool("get_annotations").execute("get", { limit: 1, cursor: first.nextCursor }));
  expect(next.items).toHaveLength(1);
  expect(next.items[0].id).not.toBe(first.items[0].id);
  expect(next.nextCursor).toBeNull();
  await expect(tool("get_annotations").execute("get", { bookId: "other", cursor: first.nextCursor })).rejects.toMatchObject({ code: "annotations/invalid-cursor" });
});

test("edit and approved ask deletion use exact lookup, retaining the approval boundary", async () => {
  const { deps, stores, tool } = fixture();
  deps.annotations.listAnnotations = async () => { throw new Error("Unexpected full list"); };
  const expectedRevision = (await deps.annotations.inspectAnnotation("note"))!.revision;
  await tool("edit_annotation").execute("edit", { annotationId: "note", body: "Revised", expectedRevision });
  expect(await deps.annotations.getAnnotation(note.id)).toMatchObject({ body: "Revised" });
  const result = parsed(await tool("delete_annotation").execute("delete", { annotationId: "ask" }));
  expect(result).toMatchObject({ deleted: true, annotationKind: "ask" });
  expect(await deps.annotations.getAnnotation(ask.id)).toBeNull();
  expect(stores.interactions).toMatchObject([{ kind: "permission", action: "delete-annotation" }]);
});

test("declined ask deletion preserves the trace", async () => {
  const { deps, tool } = fixture();
  deps.interactions.request = async () => ({ cancelled: true });
  expect(parsed(await tool("delete_annotation").execute("delete", { annotationId: "ask" }))).toMatchObject({ deleted: false });
  expect(await deps.annotations.getAnnotation(ask.id)).toEqual(ask);
});

test("exact read storage errors are not reported as absent annotations", async () => {
  const { deps, tool } = fixture();
  deps.annotations.inspectAnnotation = async () => { throw new AppError("db/locked", "Locked"); };
  await expect(tool("get_annotations").execute("get", { annotationId: "note" })).rejects.toMatchObject({ code: "db/locked" });
});

test("editing requires the observed revision and never overwrites a newer note", async () => {
  const { deps, tool } = fixture();
  const observed = parsed(await tool("get_annotations").execute("read", { annotationId: "note" }));
  expect(observed.revision).toMatch(/^ann1:[a-f0-9]{64}$/);
  await deps.annotations.applyChanges([{ op: "updateNote", annotationId: "note", body: "Changed by another actor", expectedRevision: (await deps.annotations.inspectAnnotation("note"))!.revision }]);
  await expect(tool("edit_annotation").execute("edit", { annotationId: "note", body: "Lost edit", expectedRevision: observed.revision })).rejects.toMatchObject({ code: "annotations/conflict" });
  expect(await deps.annotations.getAnnotation("note")).toMatchObject({ body: "Changed by another actor" });
  await expect(tool("edit_annotation").execute("edit", { annotationId: "note", body: "No token" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
});

test("a change during deletion approval invalidates that approval's target version", async () => {
  const { deps, tool } = fixture();
  deps.interactions.request = async () => {
    await deps.annotations.applyChanges([{ op: "updateNote", annotationId: "note", body: "Changed while approval was open", expectedRevision: (await deps.annotations.inspectAnnotation("note"))!.revision }]);
    return { optionId: "approve" };
  };
  await expect(tool("delete_annotation").execute("delete", { annotationId: "note" })).rejects.toMatchObject({ code: "annotations/conflict" });
  expect(await deps.annotations.getAnnotation("note")).toMatchObject({ body: "Changed while approval was open" });
});

test("mixed batches honor decline and do not apply any accompanying edits", async () => {
  const { deps, tool } = fixture();
  const changes = [
    { op: "updateNote", annotationId: "note", body: "New", expectedRevision: (await deps.annotations.inspectAnnotation("note"))!.revision },
    { op: "remove", kind: "ask", annotationId: "ask", expectedRevision: (await deps.annotations.inspectAnnotation("ask"))!.revision },
  ];
  deps.interactions.request = async () => ({ optionId: "decline" });
  expect(parsed(await tool("apply_annotation_changes").execute("batch", { changes }))).toMatchObject({ committed: false });
  expect(await deps.annotations.getAnnotation("note")).toEqual(note);
  expect(await deps.annotations.getAnnotation("ask")).toEqual(ask);
  deps.interactions.request = async () => ({ optionId: "approve" });
  const result = parsed(await tool("apply_annotation_changes").execute("batch", { changes }));
  expect(result).toMatchObject({ atomic: true, changes: [{ annotationId: "note" }, { annotationId: "ask", revision: null }] });
  expect(await deps.annotations.getAnnotation("note")).toMatchObject({ body: "New" });
  expect(await deps.annotations.getAnnotation("ask")).toBeNull();
});

test("batch checks every version again after approval, without partial changes", async () => {
  const { deps, tool } = fixture();
  const changes = [
    { op: "updateNote", annotationId: "note", body: "Lost edit", expectedRevision: (await deps.annotations.inspectAnnotation("note"))!.revision },
    { op: "remove", kind: "ask", annotationId: "ask", expectedRevision: (await deps.annotations.inspectAnnotation("ask"))!.revision },
  ];
  deps.interactions.request = async () => {
    await deps.annotations.applyChanges([{ op: "updateNote", annotationId: "note", body: "Newer version", expectedRevision: (await deps.annotations.inspectAnnotation("note"))!.revision }]);
    return { optionId: "approve" };
  };
  await expect(tool("apply_annotation_changes").execute("batch", { changes })).rejects.toMatchObject({ code: "annotations/conflict" });
  expect(await deps.annotations.getAnnotation("ask")).toEqual(ask);
  expect(await deps.annotations.getAnnotation("note")).toMatchObject({ body: "Newer version" });
});

test("cancellation before dispatch does not commit a conditional batch", async () => {
  const { deps, tool } = fixture();
  const changes = [{ op: "updateNote", annotationId: "note", body: "Cancelled", expectedRevision: (await deps.annotations.inspectAnnotation("note"))!.revision }];
  const controller = new AbortController(); controller.abort();
  await expect(tool("apply_annotation_changes").execute("batch", { changes }, controller.signal)).rejects.toMatchObject({ code: "annotations/cancelled" });
  expect(await deps.annotations.getAnnotation("note")).toEqual(note);
});

test("versioned creation preserves exact whitespace and passes the read fence and cancellation to the host", async () => {
  const { createAgentTurnState } = await import("./turn-state");
  const { deps } = fixture();
  const state = createAgentTurnState(); state.spoilerFence = { throughChapterIndex: 2 };
  const range = { bookId, contentVersion: "sha256:old", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)" };
  const calls: unknown[] = [];
  deps.bookText.readRange = async (query, signal) => { calls.push([query, signal]); return { range, text: " Q", offset: 0, totalLength: 7, nextOffset: 2, sectionIndex: 0, context: { before: "", after: "" } }; };
  deps.annotations.createHighlight = async (input, signal) => { calls.push([input, signal]); return { kind: "highlight", ...input, color: input.color ?? "yellow", style: input.style ?? "highlight", id: "created" as Id, createdAt: timestamp, updatedAt: timestamp }; };
  deps.annotations.createNote = async (input, signal) => { calls.push([input, signal]); return { kind: "note", ...input, id: "created" as Id, createdAt: timestamp, updatedAt: timestamp }; };
  const create = buildAnnotationTools({ kind: "book", bookId }, deps, state).find(tool => tool.name === "create_annotation")!;
  const controller = new AbortController();
  const result = parsed(await create.execute("h", { kind: "highlight", range, text: " Quote " }, controller.signal));
  expect(result).toMatchObject({ range, text: " Quote " });
  expect(calls[0]).toEqual([{ range, limit: 2, contextChars: 0, throughChapterIndex: 2 }, controller.signal]);
  expect(calls[1]).toEqual([expect.objectContaining({ range, text: " Quote " }), controller.signal]);
  expect(parsed(await create.execute("n", { kind: "note", range, body: " Note ", quotedText: " Quote " }))).toMatchObject({ body: "Note", quotedText: " Quote ", range });
  deps.bookText.readRange = async () => { throw new AppError("reader/stale-location", "Changed"); };
  const count = calls.length;
  await expect(create.execute("bad", { kind: "highlight", range, text: "Quote" })).rejects.toMatchObject({ code: "reader/stale-location" });
  await expect(create.execute("bad", { kind: "highlight", range: { ...range, bookId: "wrong" }, text: "Quote" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
  controller.abort();
  await expect(create.execute("abort", { kind: "highlight", range, text: "Quote" }, controller.signal)).rejects.toHaveProperty("name", "AbortError");
  expect(calls).toHaveLength(count);
});

test("only the current versioned reader selection bypasses the narrative read fence", async () => {
  const fencedBookId = "fenced-book" as Id;
  const { deps } = createInMemoryDeps({
    books: [{ id: fencedBookId, title: "Fenced book", status: "reading", narrativity: "narrative" }],
    chapters: { [fencedBookId]: [{ text: "safe" }, { text: "Quote" }] },
  });
  await deps.reader.openBook(fencedBookId);
  const located = await deps.bookText.searchLocations({ bookId: fencedBookId, query: "Quote" });
  const range = located.hits[0]!.range!;
  await deps.reader.selectRange(range);
  const { createAgentTurnState } = await import("./turn-state");
  const state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const calls: unknown[] = [], readRange = deps.bookText.readRange;
  deps.bookText.readRange = async (query, signal) => {
    calls.push([query, signal]);
    return readRange(query, signal);
  };
  const create = buildAnnotationTools({ kind: "book", bookId: fencedBookId }, deps, state)
    .find(tool => tool.name === "create_annotation")!;
  const result = parsed(await create.execute("current", {
    kind: "highlight",
    range,
    text: "Quote",
  }));
  expect(result).toMatchObject({ kind: "highlight", text: "Quote", range });
  const firstQuery = (calls[0] as [Record<string, unknown>, AbortSignal | undefined])[0];
  expect(firstQuery).toEqual({ range, limit: 2, contextChars: 0 });
  expect(calls.every(call => {
    const query = (call as [Record<string, unknown>, AbortSignal | undefined])[0];
    return !("throughChapterIndex" in query);
  })).toBe(true);
  expect(await deps.annotations.getAnnotation(result.id)).toMatchObject({ kind: "highlight", text: "Quote", bookId: fencedBookId, range });
});
