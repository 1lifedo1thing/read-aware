/**
 * AnnotationsPort — a thin adapter over the shared domain layer (origin
 * "agent"). Reads return the canonical AnnotationItem union unchanged;
 * recordAsk goes through the domain's agent-only createAsk verb, which owns
 * the origin stamp and the list invalidation.
 */
import type { AnnotationsPort } from "@read-aware/agent";
import { createDomainApi } from "../../../../domain";

export function createAnnotationsPort(): AnnotationsPort {
  const annotations = createDomainApi("agent").annotations;
  return {
    inspectAnnotation: (id) => annotations.queries.inspect(id),
    applyChanges: (changes, signal) => annotations.commands.applyChanges(changes, signal),
    pageAnnotations: (input) => annotations.queries.page(input),
    getAnnotation: (id) => annotations.queries.get(id),
    listAnnotations: async (filter) =>
      annotations.queries.list({
        bookId: filter?.bookId ? String(filter.bookId) : undefined,
        query: filter?.query,
        kind: filter?.kind,
      }),
    createHighlight: async ({ bookId, text, anchor, chapter, color, style, range }, signal) =>
      annotations.commands.createHighlight({
        bookId: String(bookId),
        text,
        range,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
        color,
        style,
      }, signal),
    createNote: async ({ bookId, body, quotedText, anchor, chapter, range }, signal) =>
      annotations.commands.createNote({
        bookId: String(bookId),
        body,
        range,
        quotedText,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
      }, signal),
    recordAsk: async ({ bookId, question, anchor, chapter }) => {
      await annotations.commands.createAsk({
        bookId: String(bookId),
        text: question,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
      });
    },
  };
}
