import { errorCode } from "@read-aware/core";
import { copyEventCause, mergeEventCauses, ObservationCauses, type DomainActor } from "../platform/domain-actor";

export type QueryObservation<T> = { revision: number } & (
  | { status: "ready"; result: T }
  | { status: "error"; errorCode: string }
);

/** Host-private dependencies. Neither changes nor their causal identities enter
 * the query payload or enlarge the reader's authorization. */
export type QueryObservationSources = {
  origin?: DomainActor;
  subscribe(notify: (source: object) => void): () => void;
  settle(signal: AbortSignal): Promise<void>;
  hasPending(): boolean;
};

/** One bounded poll and callback at a time. Keep write provenance through
 * coalescing, failed reads and callback retries, without keeping an event log. */
export function observeQuery<T>(read: () => Promise<T>, handler: (event: QueryObservation<T>) => unknown,
  deps: { schedule(work: () => void): () => void; report(error: unknown): void; failureCode: string; release(): void },
  lifetime?: AbortSignal, sources?: QueryObservationSources): () => void {
  const controller = new AbortController(), causes = new ObservationCauses(sources?.origin);
  let disposed = false, revision = 0, delivered: string | undefined;
  let cancelTimer: (() => void) | undefined, unsubscribe: (() => void) | undefined;
  let retry: { identity: string; source: object } | undefined, unread: object | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    cancelTimer?.(); cancelTimer = undefined;
    lifetime?.removeEventListener("abort", dispose);
    try { unsubscribe?.(); } finally { deps.release(); }
  };
  const schedule = () => {
    if (!disposed) cancelTimer = deps.schedule(() => { cancelTimer = undefined; void poll(); });
  };
  const poll = async () => {
    // Native writes can be visible before their completion broadcast. Await
    // short durable work only, never model tasks or observation callbacks.
    if (sources) {
      try { await sources.settle(controller.signal); }
      catch (error) { if (!disposed) { deps.report(error); schedule(); } return; }
    }
    if (disposed) return;
    const sourceRevision = causes.revision;
    let sample: Omit<Extract<QueryObservation<T>, { status: "ready" }>, "revision"> |
      Omit<Extract<QueryObservation<T>, { status: "error" }>, "revision">;
    try { sample = { status: "ready", result: await read() }; }
    catch (error) {
      if (disposed) return;
      deps.report(error);
      sample = { status: "error", errorCode: errorCode(error) ?? deps.failureCode };
    }
    if (disposed) return;
    // Retain pending causes until a sample spans no tracked changes. A write
    // during the read can invalidate even a successful or failed query result.
    if (sourceRevision !== causes.revision || sources?.hasPending()) { schedule(); return; }
    const identity = JSON.stringify(sample);
    const retained = [unread, retry?.identity === identity ? retry.source : undefined]
      .filter((source): source is object => !!source);
    const event = causes.take({ ...structuredClone(sample), revision: revision + 1 },
      retained.length ? mergeEventCauses(retained, {}) : undefined);
    unread = sample.status === "error" ? copyEventCause(event, {}) : undefined;
    if (identity !== delivered) {
      revision++;
      retry = { identity, source: copyEventCause(event, {}) };
      try { await handler(event); delivered = identity; retry = undefined; }
      catch (error) { deps.report(error); }
    } else retry = undefined;
    schedule();
  };
  try {
    unsubscribe = sources?.subscribe(source => { if (!disposed) causes.add(source); });
    lifetime?.addEventListener("abort", dispose, { once: true });
    if (lifetime?.aborted) dispose();
    else void poll();
  } catch (error) { dispose(); throw error; }
  return dispose;
}
