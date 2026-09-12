import { AppError, type BookTextPriority, type BookTextWaitReason } from "@read-aware/core";

type Entry = {
  signal: AbortSignal;
  priority(): BookTextPriority;
  state(reason: BookTextWaitReason): void;
  read(): Promise<string>;
  resolve(value: string): void;
  reject(error: unknown): void;
  abort(): void;
};

/** Bounds actual section reads. Cancelling an in-flight parser does not free its slot early. */
export class BookTextScheduler {
  private queue: Entry[] = [];
  private running = 0;
  private normalStreak = 0;
  constructor(private readonly yieldToReader: (signal: AbortSignal, waiting: (value: boolean) => void) => Promise<void>) {}

  read(signal: AbortSignal, priority: () => BookTextPriority, state: Entry["state"], read: Entry["read"]): Promise<string> {
    signal.throwIfAborted();
    if (this.queue.length >= 64) throw new AppError("library/text-task-limit", "Text extraction queue is full");
    return new Promise((resolve, reject) => {
      const entry: Entry = { signal, priority, state, read, resolve, reject, abort: () => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1); signal.removeEventListener("abort", entry.abort);
        reject(signal.reason);
      } };
      this.queue.push(entry); signal.addEventListener("abort", entry.abort, { once: true });
      state("queue"); this.pump();
    });
  }

  private pump(): void {
    while (this.running < 2 && this.queue.length) {
      // FIFO within a tier; after four normal dispatches, the oldest background
      // request gets a turn. Priority changes are read at section dispatch.
      const background = this.queue.findIndex(entry => entry.priority() === "background");
      const normal = this.queue.findIndex(entry => entry.priority() === "normal");
      const index = background >= 0 && (this.normalStreak >= 4 || normal < 0) ? background : Math.max(0, normal);
      const entry = this.queue.splice(index, 1)[0]!;
      this.normalStreak = entry.priority() === "normal" ? this.normalStreak + 1 : 0;
      entry.signal.removeEventListener("abort", entry.abort);
      this.running++;
      void (async () => {
        entry.signal.throwIfAborted();
        await this.yieldToReader(entry.signal, waiting => entry.state(waiting ? "reader" : null));
        entry.signal.throwIfAborted(); entry.state(null);
        const value = await entry.read(); entry.signal.throwIfAborted(); return value;
      })().then(entry.resolve, entry.reject).finally(() => { this.running--; this.pump(); });
    }
  }
}
