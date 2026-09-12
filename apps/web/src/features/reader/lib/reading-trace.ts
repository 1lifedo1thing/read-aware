import type { ReadingSessionBucket, SessionPosition } from "../../../platform/reading-session";
import { AppError } from "@read-aware/core";
import { bucketKeyAt, sameBucket, type BucketKey } from "./reading-session-policy";

type TraceStore = {
  accrue(bookId: string, ms: number, at: number): Promise<unknown>;
  position(bookId: string, progress: SessionPosition, at: number): Promise<unknown>;
  pending(): Promise<ReadingSessionBucket[]>;
  flush(buckets: ReadingSessionBucket[]): Promise<unknown>;
  report(error: unknown): void;
};

/** One product session, independent of React mounts. Retirement fences writers
 * synchronously, then joins accepted time AND position writes before flushing. */
export class ReadingTrace {
  private live = true;
  private sample: (() => void) | undefined;
  private retirement: Promise<void> | undefined;
  private writeFailure: { error: unknown } | undefined;

  constructor(
    readonly id: string,
    readonly bookId: string,
    private readonly store: TraceStore,
    private readonly enqueue: (work: () => Promise<void>) => Promise<void>,
  ) {}

  get accepting(): boolean { return this.live; }

  /** Capture the partial timer interval without retiring its React sampler. */
  sampleNow(): void { if (this.live) this.sample?.(); }

  bindSampler(sample: () => void): () => void {
    if (!this.live) return () => {};
    this.sample?.();
    this.sample = sample;
    return () => {
      if (this.sample !== sample) return;
      sample();
      this.sample = undefined;
    };
  }

  accrue(ms: number, at: number): void {
    if (!this.live || ms <= 0) return;
    this.background(async () => {
      await this.rollover(at);
      await this.write(() => this.store.accrue(this.bookId, ms, at));
    });
  }

  position(progress: SessionPosition, at: number): void {
    if (!this.live) return;
    const snapshot = structuredClone(progress);
    this.background(async () => {
      await this.rollover(at);
      await this.write(() => this.store.position(this.bookId, snapshot, at));
    });
  }

  pause(): void {
    if (this.live) this.background(() => this.flushExcept());
  }

  retire(): Promise<void> {
    if (this.retirement) return this.retirement;
    this.sample?.();
    this.sample = undefined;
    this.live = false;
    this.retirement = this.enqueue(async () => {
      await this.flushExcept();
      // A successful flush cannot make a failed accrual/position write durable.
      if (this.writeFailure) throw this.writeFailure.error;
    });
    return this.retirement;
  }

  private async write(work: () => Promise<unknown>): Promise<void> {
    try { await work(); }
    catch (error) { this.writeFailure ??= { error }; throw error; }
  }

  private async rollover(at: number): Promise<void> {
    // A failed old-bucket flush must not discard the new reading observation.
    // Both buckets remain scoped to this session for the final retirement.
    try { await this.flushExcept(bucketKeyAt(this.bookId, at)); }
    catch (error) { this.store.report(error); }
  }

  private async flushExcept(keep?: BucketKey): Promise<void> {
    const pending = await this.store.pending();
    const closing = pending.filter(bucket => bucket.bookId === this.bookId && !(keep && sameBucket(bucket, keep)));
    if (closing.length) await this.store.flush(closing);
  }

  private background(work: () => Promise<void>): void {
    void this.enqueue(work).catch(error => this.store.report(error));
  }
}

/** The single reader's sessions share a write queue, including rapid same-book
 * reopen: an old session's final flush always precedes the new one's writes. */
export class ReadingTraceCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private active: ReadingTrace | undefined;
  private readonly pending = new Set<Promise<void>>();
  private paused = false;

  constructor(private readonly store: TraceStore) {}

  current(bookId: string): ReadingTrace | undefined {
    return this.active?.bookId === bookId && this.active.accepting ? this.active : undefined;
  }

  /** Retire the live session and wait for every queued flush; used by coordinated shutdown. */
  async settle(): Promise<void> {
    const active = this.active;
    if (active?.accepting) await active.retire();
    await this.tail;
  }

  /** Reserve the queue synchronously after the current timer sample. Later
   * observations (including replacement sessions) retain their order behind
   * the reservation. Cancellation never releases native work still running.
   * This fences this reader's writes, not other domains or native processes. */
  async withWritesPaused<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    // Reentrancy must fail rather than enqueue a barrier behind its own release.
    if (this.paused) throw new AppError("backup/busy", "Reading writes are already reserved for backup");
    const active = this.active;
    let release = () => {};
    this.paused = true;
    try {
      active?.sampleNow();
      const accepted = [...this.pending];
      const reservation = new Promise<void>(resolve => { release = resolve; });
      this.tail = this.tail.then(() => reservation);
      // A queue failure cannot let the backup overtake another accepted write.
      const results = await Promise.allSettled(accepted);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      signal?.throwIfAborted();
      return await operation();
    } finally {
      this.paused = false;
      release();
    }
  }

  begin(id: string, bookId: string): ReadingTrace {
    if (this.active) void this.active.retire().catch(error => this.store.report(error));
    const trace = new ReadingTrace(id, bookId, this.store, work => {
      const task = this.tail.then(work);
      this.pending.add(task);
      const done = () => { this.pending.delete(task); };
      task.then(done, done);
      // Failure does not strand subsequent sessions; the caller still sees it.
      this.tail = task.catch(() => {});
      return task;
    });
    this.active = trace;
    return trace;
  }
}
