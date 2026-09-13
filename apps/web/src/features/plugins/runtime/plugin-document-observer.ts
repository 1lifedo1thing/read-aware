import { AppError, errorCode } from "@read-aware/core";
import type { PluginDocumentObservation, PluginDocumentObservationResult, PluginDisposable } from "@read-aware/plugin-types";
import { createLogger } from "../../../platform/logger";
import { actorCause, copyEventCause, mergeEventCauses, ObservationCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import type { PluginLifecycleController } from "./plugin-lifecycle";

const log = createLogger("plugin-documents");
const defaults = {
  schedule(work: () => void) { const timer = setTimeout(work, 1000); return () => clearTimeout(timer); },
  report(error: unknown) { log.warn("Private document observation failed", error); },
};
type DocumentTarget = { collection: string; id: string };
type DocumentChange = { targets: readonly DocumentTarget[] };
type PendingWrite = { targets: readonly DocumentTarget[]; settled: Promise<void> };

/** Private query snapshots, not write events. Each owner shares one limit. */
export class PluginDocumentObserver {
  private count = 0;
  private changes = new Set<(change: DocumentChange) => void>();
  private writes = new Set<PendingWrite>();
  constructor(private readonly lifecycle: PluginLifecycleController, private readonly deps = defaults) {}

  /** Keep native reads behind dispatched local writes until their actual receipt
   * is known. A failed/conflicting commit must never publish a causal change. */
  async write<T>(targets: readonly DocumentTarget[], actor: DomainActor, perform: () => Promise<T>, committed: (result: T) => boolean = () => true): Promise<T> {
    actorCause(actor);
    const settled = Promise.withResolvers<void>();
    const pending: PendingWrite = { targets, settled: settled.promise };
    this.writes.add(pending);
    try {
      const result = await perform();
      if (targets.length && committed(result)) {
        const event = stampEventCause({ targets }, actor);
        for (const change of this.changes) change(event);
      }
      return result;
    } finally { this.writes.delete(pending); settled.resolve(); }
  }

  observe<T>(read: () => Promise<PluginDocumentObservationResult<T>>, handler: (event: PluginDocumentObservation<T>) => unknown,
    matches: (target: DocumentTarget) => boolean = () => true, actor?: DomainActor): PluginDisposable {
    if (typeof handler !== "function") throw new AppError("plugin/invalid-argument", "Expected document observation callback");
    return this.lifecycle.stage(() => {
      if (this.lifecycle.signal.aborted) throw new AppError("plugin/cancelled", "Document observer owner retired");
      if (this.count >= 64) throw new AppError("plugin/quota-exceeded", "Too many document observers");
      ++this.count;
      const causes = new ObservationCauses(actor);
      const changed = (change: DocumentChange) => { if (change.targets.some(matches)) causes.add(change); };
      const pendingWrites = () => [...this.writes].filter(write => write.targets.some(matches));
      this.changes.add(changed);
      let disposed = false, sequence = 0, delivered: string | undefined, cancelTimer: (() => void) | undefined;
      let retry: { identity: string; source: object } | undefined;
      let unread: object | undefined;
      const dispose = () => {
        if (disposed) return;
        disposed = true; --this.count; cancelTimer?.(); cancelTimer = undefined;
        this.changes.delete(changed);
        this.lifecycle.signal.removeEventListener("abort", dispose);
      };
      const poll = async () => {
        const schedule = () => { if (!disposed) cancelTimer = this.deps.schedule(() => { cancelTimer = undefined; void poll(); }); };
        // A write may have started before this observer was installed. It is
        // still owned here, so do not mistake its pending receipt for a new root.
        while (!disposed) {
          const writes = pendingWrites();
          if (!writes.length) break;
          await Promise.all(writes.map(write => write.settled));
        }
        if (disposed) return;
        const revision = causes.revision;
        let sample: { status: "ready"; result: PluginDocumentObservationResult<T> } | { status: "error"; errorCode: string };
        try { sample = { status: "ready", result: await read() }; }
        catch (error) {
          if (disposed) return;
          this.deps.report(error);
          sample = { status: "error", errorCode: errorCode(error) ?? "ipc/unknown" };
        }
        if (disposed) return;
        if (revision !== causes.revision || pendingWrites().length) { schedule(); return; }
        const identity = JSON.stringify(sample);
        const retained = [unread, retry?.identity === identity ? retry.source : undefined].filter((source): source is object => !!source);
        const observation = causes.take({ ...structuredClone(sample), sequence: sequence + 1 }, retained.length ? mergeEventCauses(retained, {}) : undefined);
        // Read failures have not observed the committed row yet. Stable error
        // polls and later recovery must not silently turn that write into a root.
        unread = sample.status === "error" ? copyEventCause(observation, {}) : undefined;
        if (identity !== delivered) {
          sequence++;
          // Retry retains provenance even if the previous callback mutated its
          // own payload or completed some writes before reporting an error.
          retry = { identity, source: copyEventCause(observation, {}) };
          try { await handler(observation); delivered = identity; retry = undefined; }
          catch (error) { this.deps.report(error); }
        } else retry = undefined;
        schedule();
      };
      this.lifecycle.signal.addEventListener("abort", dispose, { once: true });
      void poll();
      return { dispose };
    });
  }
}
