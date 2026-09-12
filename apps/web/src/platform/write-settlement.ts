/** Tracks dispatched durable writes so shutdown can wait for their real receipts.
 * Tracking never changes an outcome: a tracked failure still rejects its caller. */
export class WriteSettlement {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    const done = () => { this.pending.delete(work); };
    work.then(done, done);
    return work;
  }

  /** Register the accepted operation before preparation can yield or dispatch.
   * Keep its receipt through post-commit observers that may enqueue more work. */
  run<T>(operation: () => T | Promise<T>): Promise<T> {
    return this.track(Promise.resolve().then(operation));
  }

  get size(): number { return this.pending.size; }

  /** Resolves once every write dispatched before the call has settled, including writes
   * dispatched meanwhile; a failed write does not fail settlement. */
  async settle(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    let onAbort: (() => void) | undefined;
    const aborted = signal && new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      while (this.pending.size) {
        const settled = Promise.allSettled([...this.pending]);
        await (aborted ? Promise.race([settled, aborted]) : settled);
        signal?.throwIfAborted();
      }
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }
}

export const durableWrites = new WriteSettlement();
