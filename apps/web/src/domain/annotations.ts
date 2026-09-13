import { actorOrigin, type DomainActor } from "../platform/domain-actor";
/**
 * Annotations domain — highlights, notes, and asks over annotation-db.
 * Commands enforce the verb's invariants once, for every actor: kind checks
 * before mutation, list invalidation after, origin threading throughout.
 * `createAsk` is actor-guarded: asks are the agent runtime's passive traces,
 * so only the "agent" origin may record them.
 */
import { AppError } from "@read-aware/core";
import type {
  AnnotationItem,
  AnnotationSnapshot,
  AnnotationMutation,
  AnnotationCommitResult,
  AnnotationPage,
  AnnotationPageQuery,
  AnnotationObservation,
  AnnotationObservationQuery,
  AskItem,
  HighlightColor,
  HighlightItem,
  HighlightStyle,
  NoteItem,
} from "@read-aware/core";
import {
  createAsk,
  createHighlight,
  createNote,
  listAnnotations,
  pageAnnotations,
} from "../features/annotations/lib/annotation-db";
import type { Annotation } from "../features/annotations/lib/annotation-types";
import { inspectAnnotation, commitAnnotationMutations } from "../features/annotations/lib/annotation-mutations";
import { ANNOTATION_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";
import { AnnotationObserver, type AnnotationQueryObservation } from "./annotation-observer";
import { annotationObservationSources } from "./annotation-observation-sources";
import { createLogger } from "../platform/logger";
import { prepareAnnotationSource } from "./annotation-source";

const log = createLogger("annotation-observation");
const observationDeps = {
  schedule: (work: () => void) => { const timer = setTimeout(work, 1000); return () => clearTimeout(timer); },
  report: (error: unknown) => log.warn("Annotation observation failed", error),
};
const observer = new AnnotationObserver(observationDeps);
// Plugin quota exhaustion must not prevent the user's own reader from observing.
const nativeObserver = new AnnotationObserver(observationDeps);

/** Host-only collection surface; this does not enlarge the public Worker query. */
export function observeAllAnnotations(handler: (event: AnnotationQueryObservation<Annotation[]>) => unknown,
  lifetime?: AbortSignal): () => void {
  return nativeObserver.observeSnapshot(() => listAnnotations(), handler, lifetime, annotationObservationSources({ kind: "page" }));
}

/** Native surfaces already need the whole book; do not enlarge the public Worker payload contract. */
export function observeBookAnnotations(bookId: string, handler: (event: AnnotationQueryObservation<Annotation[]>) => unknown,
  lifetime?: AbortSignal): () => void {
  if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 512) {
    throw new AppError("annotations/invalid-input", "A book ID is required");
  }
  return nativeObserver.observeSnapshot(() => listAnnotations({ bookId }), handler, lifetime,
    annotationObservationSources({ kind: "page", query: { bookId } }));
}

export function toAnnotationItem(annotation: Annotation): AnnotationItem {
  const anchor = annotation.cfiRange ?? undefined;
  const chapterHref = annotation.chapterHref ?? undefined;
  if (annotation.type === "highlight") {
    return {
      kind: "highlight",
      ...(annotation.range ? { range: annotation.range } : {}),
      id: annotation.id,
      bookId: annotation.bookId,
      text: annotation.text,
      anchor,
      chapterHref,
      color: annotation.color ?? "yellow",
      style: annotation.style ?? "highlight",
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };
  }
  if (annotation.type === "note") {
    return {
      kind: "note",
      ...(annotation.range ? { range: annotation.range } : {}),
      id: annotation.id,
      bookId: annotation.bookId,
      quotedText: annotation.text || undefined,
      body: annotation.content ?? "",
      anchor,
      chapterHref,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };
  }
  return {
    kind: "ask",
    id: annotation.id,
    bookId: annotation.bookId,
    text: annotation.text,
    anchor,
    chapterHref,
    createdAt: annotation.createdAt,
  };
}

export type AnnotationQueries = {
  inspect(annotationId: string): Promise<AnnotationSnapshot | null>;
  page(input?: AnnotationPageQuery): Promise<AnnotationPage>;
  /** Missing IDs return null; storage failures remain failures. */
  get(annotationId: string): Promise<AnnotationItem | null>;
  list(filter?: {
    bookId?: string;
    kind?: "highlight" | "note" | "ask";
    query?: string;
  }): Promise<AnnotationItem[]>;
};

export type AnnotationCommands = {
  applyChanges(changes: AnnotationMutation[], signal?: AbortSignal): Promise<AnnotationCommitResult>;
  createHighlight(input: {
    range?: import("@read-aware/core").BookTextRange;
    bookId: string;
    text: string;
    anchor?: string | null;
    chapterHref?: string | null;
    color?: HighlightColor;
    style?: HighlightStyle;
  }, signal?: AbortSignal): Promise<HighlightItem>;
  createNote(input: {
    range?: import("@read-aware/core").BookTextRange;
    bookId: string;
    body: string;
    quotedText?: string;
    anchor?: string | null;
    chapterHref?: string | null;
  }, signal?: AbortSignal): Promise<NoteItem>;
  /** Agent-only verb: record a passive trace of a book-thread question. */
  createAsk(input: {
    bookId: string;
    text: string;
    anchor?: string | null;
    chapterHref?: string | null;
  }): Promise<AskItem>;
};

export type AnnotationsDomain = {
  queries: AnnotationQueries;
  commands: AnnotationCommands;
  events: {
    subscribe: DomainEventSubscribe<(typeof ANNOTATION_EVENTS)[number]>;
    observe(query: AnnotationObservationQuery, handler: (event: AnnotationObservation) => unknown): () => void;
  };
};

export function createAnnotationsDomain(origin: DomainActor, lifetime?: AbortSignal): AnnotationsDomain {
  const annotationId = (id: string) => {
    if (typeof id !== "string" || !id.trim() || id.length > 512) throw new AppError("annotations/invalid-input", "A non-empty annotation ID is required");
    return id;
  };

  const queries: AnnotationQueries = {
    inspect: async (id) => {
      const snapshot = await inspectAnnotation(annotationId(id), true);
      return snapshot ? { ...snapshot, annotation: toAnnotationItem(snapshot.annotation) } : null;
    },
    page: async (input) => {
      const page = await pageAnnotations(input);
      return { ...page, items: page.items.map(toAnnotationItem) };
    },
    get: async (id) => {
      const annotation = (await inspectAnnotation(annotationId(id), true))?.annotation;
      return annotation ? toAnnotationItem(annotation) : null;
    },
    list: async (filter) => {
      const page = await queries.page(filter ? { bookId: filter.bookId, kind: filter.kind, query: filter.query, limit: 100 } : { limit: 100 });
      if (page.nextCursor) throw new AppError("annotations/read-budget-exceeded", "Use annotation pages for a larger collection");
      return page.items;
    },
  };

  const commands: AnnotationCommands = {
    applyChanges: async (changes, signal) => {
      const result = await commitAnnotationMutations(changes, origin, signal);
      return result;
    },
    createHighlight: async (input, signal = lifetime) => {
      input = { ...input };
      if (input.style !== undefined && input.style !== "highlight" && input.style !== "underline") {
        throw new AppError("annotations/invalid-input", "Unknown highlight style");
      }
      const source = input.range === undefined ? undefined : await prepareAnnotationSource({ ...input, range: input.range }, signal);
      signal?.throwIfAborted();
      const highlight = await createHighlight(
        String(input.bookId),
        source?.range.cfi ?? input.anchor ?? null,
        input.chapterHref ?? null,
        String(input.text),
        input.color ?? "yellow",
        input.style ?? "highlight",
        origin,
        source ?? (signal ? { signal } : undefined),
      );
      return toAnnotationItem(highlight) as HighlightItem;
    },
    createNote: async (input, signal = lifetime) => {
      input = { ...input };
      const source = input.range === undefined ? undefined : await prepareAnnotationSource({ ...input, range: input.range, text: input.quotedText ?? "" }, signal);
      signal?.throwIfAborted();
      const note = await createNote(
        String(input.bookId),
        source?.range.cfi ?? input.anchor ?? null,
        input.chapterHref ?? null,
        String(input.quotedText ?? ""),
        String(input.body),
        origin,
        source ?? (signal ? { signal } : undefined),
      );
      return toAnnotationItem(note) as NoteItem;
    },
    createAsk: async (input) => {
      if (actorOrigin(origin) !== "agent") {
        throw new AppError("annotations/forbidden", "ask.recorded is an agent-only verb");
      }
      const ask = await createAsk(
        String(input.bookId),
        input.anchor ?? null,
        input.chapterHref ?? null,
        String(input.text),
      );
      return toAnnotationItem(ask) as AskItem;
    },
  };

  return {
    queries,
    commands,
    events: { subscribe: domainSubscribe(ANNOTATION_EVENTS, actorOrigin(origin)),
      observe: (query, handler) => observer.observe(query, async accepted => accepted.kind === "page"
        ? { kind: "page", page: await queries.page(accepted.query) }
        : { kind: "inspect", snapshot: await queries.inspect(accepted.annotationId) }, handler, lifetime,
        accepted => annotationObservationSources(accepted, origin)) },
  };
}
