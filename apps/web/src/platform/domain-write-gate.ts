import { AppError } from "@read-aware/core";
import { durableWrites, WriteSettlement } from "./write-settlement";

export type RunDomainWrite = <T>(operation: () => T | Promise<T>) => Promise<T>;

/** Covers the short local transaction, including envelope preparation and
 * committed observers. Never register a model turn or a plugin callback here:
 * those can themselves request a backup. Native revision checks remain final. */
export class DomainWriteGate {
  private readonly active = new Set<Promise<unknown>>();
  private reserved = false;
  private closed = false;
  constructor(private readonly settlement = new WriteSettlement()) {}

  run: RunDomainWrite = operation => {
    if (this.closed) return Promise.reject(new AppError("backup/busy", "Domain writes are paused for backup"));
    return this.track(this.active, operation);
  };

  async withPaused<T>(operation: (runOwned: RunDomainWrite) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.reserved) throw new AppError("backup/busy", "Domain backup scope is already reserved");
    this.reserved = true;
    const owned = new Set<Promise<unknown>>();
    let accepting = false;
    const runOwned: RunDomainWrite = work => accepting
      ? this.track(owned, work)
      : Promise.reject(new AppError("backup/busy", "Domain backup scope has ended"));
    try {
      // Keep admission open while draining: an accepted commit's observers
      // can produce a dependent event. Close synchronously at quiescence.
      // Failed writes retain their caller-owned result; capture records facts.
      while (this.active.size) await Promise.allSettled([...this.active]);
      this.closed = true;
      signal?.throwIfAborted();
      accepting = true;
      return await operation(runOwned);
    } finally {
      accepting = false;
      // Cancellation/failure never releases already-dispatched native work.
      await Promise.allSettled([...owned]);
      this.closed = false;
      this.reserved = false;
    }
  }

  private track<T>(pending: Set<Promise<unknown>>, operation: () => T | Promise<T>): Promise<T> {
    // Register before invoking synchronously: KV/secret queues must retain
    // their immediate optimistic mirror, including reentrant observers.
    const result = Promise.withResolvers<T>();
    const work = this.settlement.track(result.promise);
    pending.add(work);
    const done = () => { pending.delete(work); };
    work.then(done, done);
    try { result.resolve(operation()); } catch (error) { result.reject(error); }
    return work;
  }
}

const domainWrites = new DomainWriteGate(durableWrites);
export const runDomainWrite = domainWrites.run;
export const withDomainBackup = <T>(operation: (runOwned: RunDomainWrite) => Promise<T>, signal?: AbortSignal) =>
  domainWrites.withPaused(operation, signal);

/** Snapshot queues already report dispatched failures. Admission failures
 * must use that same surface, and void setters must not leak rejections. */
export function runObservedDomainWrite<T>(operation: () => T | Promise<T>, rejected: (error: unknown) => void,
  run: RunDomainWrite = runDomainWrite): Promise<T> {
  let started = false;
  const work = run(() => { started = true; return operation(); });
  void work.catch(error => { if (!started) rejected(error); });
  return work;
}
