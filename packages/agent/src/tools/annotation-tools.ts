import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeBookRangeQuery, type BookTextRange, type HighlightColor, type HighlightStyle, type Id } from "@read-aware/core";
import type { AnnotationItem, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";
import { bookRangeSchema } from "./book-range-schema";
import type { AgentTurnState } from "./turn-state";
import { buildAnnotationBatchTool } from "./annotation-batch-tool";

const highlightColorSchema = Type.Union(
  [
    Type.Literal("yellow"),
    Type.Literal("green"),
    Type.Literal("blue"),
    Type.Literal("pink"),
  ],
  { description: "Highlight color" },
);

function annotationSubject(annotation: AnnotationItem): string {
  if (annotation.kind === "note") return annotation.body.slice(0, 80) || "Untitled note";
  return annotation.text.slice(0, 80) || `${annotation.kind} ${annotation.id}`;
}

export function buildAnnotationTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  const createAnnotation: AgentTool = {
    name: "create_annotation",
    label: "Create annotation",
    description:
      "Create a note or a highlight when the user explicitly asks. When the reader asks to note something down (\"记条笔记\", \"note this\", \"帮我记一下\"), THIS is the tool — the note must land in the book's annotation list where the reader can see it; the remember tool (invisible long-term memory) is never a substitute for a requested note. kind=note needs body (quotedText optional); kind=highlight needs text (the exact quoted passage, color optional). For a selected or searched passage, copy range from get_reading_session or find_book_locations and supply its complete exact text; do not pass separate anchor/chapterHref with range. The source version and quote are validated and preserved. Unanchored notes and legacy anchor inputs remain supported. bookId defaults to the current book.",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("note"), Type.Literal("highlight")], {
        description: "note = the user's own words; highlight = exact book text",
      }),
      body: Type.Optional(Type.String({ description: "Note body (kind=note)" })),
      text: Type.Optional(
        Type.String({ description: "Exact quoted book text (kind=highlight)" }),
      ),
      quotedText: Type.Optional(
        Type.String({ description: "Book text the note refers to (kind=note)" }),
      ),
      color: Type.Optional(highlightColorSchema),
      style: Type.Optional(Type.Union([Type.Literal("highlight"), Type.Literal("underline")], {
        description: "Mark style (kind=highlight); defaults to highlight. Use underline when the user requests underlining.",
      })),
      range: Type.Optional(bookRangeSchema),
      bookId: Type.Optional(Type.String()),
      anchor: Type.Optional(Type.String()),
      chapterHref: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { kind, body, text, quotedText, color, style, bookId, anchor, chapterHref, range: rawRange } = params as {
        kind: "note" | "highlight";
        range?: BookTextRange;
        body?: string;
        text?: string;
        quotedText?: string;
        color?: HighlightColor;
        style?: HighlightStyle;
        bookId?: string;
        anchor?: string;
        chapterHref?: string;
      };
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      const range = rawRange === undefined ? undefined : normalizeBookRangeQuery({ range: rawRange }).range;
      if (range) {
        if (range.bookId !== target || anchor !== undefined || chapterHref !== undefined) {
          throw new AppError("annotations/invalid-input", "Range must identify the target book without separate anchor fields");
        }
        await deps.bookText.readRange({ range, limit: 2, contextChars: 0,
          ...(scope.kind === "book" && target === scope.bookId && state?.spoilerFence && !state.spoilerGranted
            ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {}),
        }, signal);
      }
      signal?.throwIfAborted();
      if (kind === "note") {
        if (!body?.trim()) throw new Error("kind=note requires a non-empty body");
        return textResult(
          await deps.annotations.createNote({
            bookId: target,
            body: body.trim(),
            quotedText: range ? quotedText : quotedText?.trim() || undefined,
            range,
            anchor,
            chapter: chapterHref,
          }, signal),
        );
      }
      if (!text?.trim()) throw new Error("kind=highlight requires non-empty text");
      return textResult(
        await deps.annotations.createHighlight({
          bookId: target,
          text: range ? text : text.trim(),
          range,
          anchor,
          chapter: chapterHref,
          color,
          style,
        }, signal),
      );
    },
  };

  const editAnnotation: AgentTool = {
    name: "edit_annotation",
    label: "Edit annotation",
    description:
      "Edit an existing annotation the user clearly identifies: replace a note's body, or change a highlight's color. First read get_annotations(annotationId) and pass its revision as expectedRevision. A conflict means nothing changed: re-read and reconsider, never blindly rebase the overwrite. Pass the field matching the annotation's kind.",
    parameters: Type.Object({
      annotationId: Type.String(),
      expectedRevision: Type.String({ description: "Revision from the exact annotation read" }),
      body: Type.Optional(Type.String({ description: "New body (notes only)" })),
      color: Type.Optional(highlightColorSchema),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const { annotationId, body, color, expectedRevision } = params as {
        annotationId: string;
        body?: string;
        color?: HighlightColor;
        expectedRevision: string;
      };
      if (body === undefined && color === undefined) {
        throw new Error("pass body (note) or color (highlight)");
      }
      const annotation = await deps.annotations.getAnnotation(annotationId as Id);
      if (!annotation) throw new Error(`annotation not found: ${annotationId}`);
      if (annotation.kind === "note") {
        if (!body?.trim()) throw new Error(`${annotationId} is a note; pass a non-empty body`);
        await deps.annotations.applyChanges([{ op: "updateNote", annotationId, body: body.trim(), expectedRevision }], signal);
        return textResult({ updated: true, annotationId, body: body.trim() });
      }
      if (annotation.kind === "highlight") {
        if (!color) throw new Error(`${annotationId} is a highlight; pass color`);
        await deps.annotations.applyChanges([{ op: "recolorHighlight", annotationId, color, expectedRevision }], signal);
        return textResult({ updated: true, annotationId, color });
      }
      throw new Error(`${annotationId} is a recorded question and cannot be edited`);
    },
  };

  const deleteAnnotation: AgentTool = {
    name: "delete_annotation",
    label: "Delete annotation",
    description:
      "Permanently delete a note, highlight, or recorded question. The host ALWAYS asks the user for permission before deletion.",
    parameters: Type.Object({ annotationId: Type.String() }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { annotationId } = params as { annotationId: string };
      const snapshot = await deps.annotations.inspectAnnotation(annotationId as Id);
      if (!snapshot) throw new AppError("annotations/not-found", `annotation not found: ${annotationId}`);
      const annotation = snapshot.annotation;
      const { answer, details } = await requestUserInteraction({
        deps,
        toolCallId,
        threadKey: threadScopeKey(scope),
        request: {
          kind: "permission",
          action: "delete-annotation",
          subject: annotationSubject(annotation),
        },
        signal,
        onUpdate,
      });
      const approved = !answer.cancelled && answer.optionId === "approve";
      if (!approved) return { ...textResult({ deleted: false, reason: "User declined." }), details };
      await deps.annotations.applyChanges([{ op: "remove", annotationId, kind: annotation.kind, expectedRevision: snapshot.revision }], signal);
      return {
        ...textResult({ deleted: true, annotationId, annotationKind: annotation.kind }),
        details,
      };
    },
  };

  return [createAnnotation, editAnnotation, deleteAnnotation, buildAnnotationBatchTool(scope, deps)];
}
