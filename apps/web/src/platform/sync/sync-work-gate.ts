import { AppError } from "@read-aware/core";

type Run = <T>(operation: () => Promise<T>) => Promise<T>;

/** Sync producers share admission, not a single execution queue. A backup
 * closes admission before draining existing work; deferred callers resume
 * against current connection state when the reservation is released. */
export class SyncWorkGate {
  private readonly active = new Set<Promise<unknown>>();
  private reservation: Promise<void> | undefined;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    while (this.reservation) await this.reservation;
    return this.track(this.active, operation);
  }

  async withPaused<T>(operation: (runOwned: Run) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.reservation) throw new AppError("backup/busy", "Sync work is already reserved for backup");
    let release!: () => void;
    this.reservation = new Promise<void>(resolve => { release = resolve; });
    const owned = new Set<Promise<unknown>>();
    let accepting = true;
    const runOwned: Run = work => {
      if (!accepting) return Promise.reject(new AppError("backup/busy", "Backup sync scope has ended"));
      return this.track(owned, work);
    };
    try {
      // A failed network cycle may have applied a valid prefix. Its caller
      // owns that failure; backup snapshots the resulting durable local state.
      await Promise.allSettled([...this.active]);
      signal?.throwIfAborted();
      return await operation(runOwned);
    } finally {
      accepting = false;
      // Even an operation that throws must retain its already-started fetches.
      await Promise.allSettled([...owned]);
      this.reservation = undefined;
      release();
    }
  }

  private track<T>(pending: Set<Promise<unknown>>, operation: () => Promise<T>): Promise<T> {
    const work = Promise.resolve().then(operation);
    pending.add(work);
    const done = () => { pending.delete(work); };
    work.then(done, done);
    return work;
  }
}
