import { AppError, normalizeAnnotationObservation, type AnnotationObservation, type AnnotationObservationQuery, type AnnotationObservationResult } from "@read-aware/core";
import { observeQuery, type QueryObservation, type QueryObservationSources } from "./query-observation";

export type AnnotationQueryObservation<T> = QueryObservation<T>;

/** Settled projection reads also observe sync/rebuild changes that have no local domain broadcast. */
export class AnnotationObserver {
  private count = 0;
  constructor(private readonly deps: { schedule(work: () => void): () => void; report(error: unknown): void }) {}

  observe(input: AnnotationObservationQuery, read: (query: AnnotationObservationQuery) => Promise<AnnotationObservationResult>,
    handler: (event: AnnotationObservation) => unknown, lifetime?: AbortSignal,
    sources?: (query: AnnotationObservationQuery) => QueryObservationSources): () => void {
    const query = normalizeAnnotationObservation(input);
    return this.observeSnapshot(() => read(structuredClone(query)), handler, lifetime, sources?.(query));
  }

  /** Host-owned reader collections share delivery/lifetime rules with public bounded queries. */
  observeSnapshot<T>(read: () => Promise<T>, handler: (event: AnnotationQueryObservation<T>) => unknown, lifetime?: AbortSignal,
    sources?: QueryObservationSources): () => void {
    if (typeof handler !== "function") throw new AppError("annotations/invalid-input", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("annotations/cancelled", "Annotation observer owner retired");
    if (this.count >= 64) throw new AppError("annotations/observer-limit", "Too many annotation observers");
    ++this.count;
    return observeQuery(read, handler, { ...this.deps, failureCode: "annotations/observation-failed", release: () => { --this.count; } }, lifetime, sources);
  }
}
