import { actorFromEvent, causalActor, copyEventCause, mergeEventCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { AppError, errorCode, type BookEnrichmentJob } from "@read-aware/core";

export type EnrichmentRequest = { bookId: string; cover: boolean; metadata: boolean; origin?: DomainActor };
export type EnrichmentOutcome = { reason: BookEnrichmentJob["reason"] };
type Entry = { request: EnrichmentRequest; job: BookEnrichmentJob; done: Promise<BookEnrichmentJob> };
const idle = (): BookEnrichmentJob => ({ phase: "idle", startedAt: null, finishedAt: null, errorCode: null, reason: null });

/** One background parser at a time. Open readers may reuse their already-parsed book immediately. */
export class EnrichmentQueue {
  private entries = new Map<string, Entry>();
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(bookId: string, source: object) => void>();
  observe(handler: (bookId: string, source: object) => void): () => void {
    this.listeners.add(handler); return () => { this.listeners.delete(handler); };
  }
  private changed(entry: Entry) {
    stampEventCause(entry.job, entry.request.origin);
    const source = copyEventCause(entry.job, { ...entry.job });
    for (const listener of this.listeners) { try { listener(entry.request.bookId, source); } catch (error) { this.report(error); } }
  }
  constructor(private run: (request: EnrichmentRequest) => Promise<EnrichmentOutcome>, private report: (error: unknown) => void,
    private now = Date.now) {}

  snapshot(bookId: string): BookEnrichmentJob { const state = this.entries.get(bookId)?.job ?? stampEventCause(idle()); return copyEventCause(state, { ...state }); }

  enqueue(request: EnrichmentRequest, work = this.run, alreadyParsed = false): Entry {
    const existing = this.entries.get(request.bookId);
    if (existing && (existing.job.phase === "queued" || existing.job.phase === "running")) {
      if (existing.job.phase === "queued") {
        const expanded = request.cover && !existing.request.cover || request.metadata && !existing.request.metadata;
        if (expanded) {
          existing.request.origin = actorFromEvent(mergeEventCauses([stampEventCause({}, existing.request.origin), stampEventCause({}, causalActor(request.origin ?? "system"))], {}));
          existing.request.cover ||= request.cover; existing.request.metadata ||= request.metadata;
          this.changed(existing);
        }
      }
      return existing;
    }
    this.entries.delete(request.bookId);
    if (this.entries.size >= 256) {
      const oldest = [...this.entries].find(([, entry]) => !["queued", "running"].includes(entry.job.phase));
      if (!oldest) throw new AppError("ui/unavailable", "Enrichment queue is full");
      this.entries.delete(oldest[0]);
    }
    const accepted = { ...request, origin: causalActor(request.origin ?? "system") }, job: BookEnrichmentJob = { ...idle(), phase: "queued" };
    const done = (alreadyParsed ? Promise.resolve() : this.tail).then(async () => {
      job.phase = "running"; job.startedAt = this.now(); this.changed(entry);
      try {
        const result = await work(accepted);
        job.reason = result.reason; job.phase = result.reason ? "skipped" : "completed";
      } catch (error) {
        job.phase = "failed"; job.errorCode = errorCode(error) ?? "internal"; this.report(error);
      } finally { job.finishedAt = this.now(); this.changed(entry); }
      return copyEventCause(job, { ...job });
    });
    const entry = { request: accepted, job, done };
    this.entries.set(request.bookId, entry);
    if (!alreadyParsed) this.tail = done;
    this.changed(entry);
    return entry;
  }
}
