import { AppError, errorCode, validateClassificationBookId, normalizeBookGraphTaskOptions, type BookGraphTaskOptions, type BookGraphTaskPort, type BookGraphTaskSnapshot, type DigestReport } from "@read-aware/core";

export interface BookGraphTaskExecution {
  bookId: string;
  rebuild: boolean;
  maxChapters: number;
  targets?: readonly number[];
  preparedDigest?(chapter: number): Promise<{ digest: import("@read-aware/core").ChapterDigest; revision: string } | undefined>;
  signal: AbortSignal;
  onStarted(): void;
  onPlan(chapters: number[]): void | Promise<void>;
  onChapterAttempted(chapter: number): void;
  onChapterCommitted(chapter: number): void;
  onReport(report: DigestReport): void;
}
type Task<TContext = unknown> = { context?: TContext; feedbackContext?: TContext; state: BookGraphTaskSnapshot; controller: AbortController; pending?: Set<number>; settled?: Promise<void>; detach(): void };
export type BookGraphTaskChange = Readonly<{ bookId: string; taskId: string; kind: "changed" | "removed" }>;
const active = (task: Task) => ["queued", "running", "cancelling"].includes(task.state.status);
const cancelled = () => new AppError("memory/cancelled", "Graph task cancelled");

/** Actor-generation ownership; execution and book serialization belong to the host. */
export class BookGraphTaskOwner<TContext = undefined> implements BookGraphTaskPort {
  private readonly tasks = new Map<string, Task<TContext>>();
  private readonly executions = new Set<Promise<void>>();
  private readonly listeners = new Set<(change: BookGraphTaskChange, context?: TContext) => void>();
  private stopped = false;
  constructor(private readonly execute: (input: BookGraphTaskExecution, context?: TContext) => Promise<DigestReport>,
    private readonly warn: (message: string, error: unknown) => void, lifetime?: AbortSignal) {
    if (lifetime?.aborted) this.stopped = true;
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }
  private assertLive() { if (this.stopped) throw cancelled(); }
  /** Host invalidation only; context is never part of a public task snapshot. */
  subscribeChanges(listener: (change: BookGraphTaskChange, context?: TContext) => void): () => void {
    this.assertLive(); this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private notify(task: Task<TContext>, kind: BookGraphTaskChange["kind"] = "changed", context = task.feedbackContext ?? task.context) {
    const change = Object.freeze({ bookId: task.state.bookId, taskId: task.state.taskId, kind });
    for (const listener of [...this.listeners]) {
      if (this.stopped) break;
      try { listener(change, context); } catch (error) { this.warn("Graph task observer failed", error); }
    }
  }
  private lookup(bookId: string, taskId: string) {
    this.assertLive(); validateClassificationBookId(bookId);
    const task = this.tasks.get(taskId);
    if (!task || task.state.bookId !== bookId) throw new AppError("memory/task-not-found", "No task belongs to this actor and book");
    return task;
  }
  private update(task: Task<TContext>, change: Partial<BookGraphTaskSnapshot>) {
    if (!active(task)) return;
    task.state = { ...task.state, ...change, revision: task.state.revision + 1, updatedAt: new Date().toISOString() };
    this.notify(task);
  }
  async start(bookId: string, mode: "catch-up" | "rebuild", options?: BookGraphTaskOptions, signal?: AbortSignal, context?: TContext) {
    return this.create(bookId, mode, normalizeBookGraphTaskOptions(options), undefined, undefined, signal, context);
  }
  private create(bookId: string, mode: "catch-up" | "rebuild", options: BookGraphTaskOptions, retryOf?: string, targets?: number[], signal?: AbortSignal, context?: TContext): BookGraphTaskSnapshot {
    this.assertLive(); validateClassificationBookId(bookId);
    if (mode !== "catch-up" && mode !== "rebuild") throw new AppError("memory/invalid-input", "Invalid graph task mode");
    if (signal?.aborted) throw cancelled();
    if ([...this.tasks.values()].filter(active).length >= 16) throw new AppError("memory/task-limit", "Too many active graph requests for this actor", { retryable: true });
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task)) { this.tasks.delete(id); this.notify(task, "removed", context); }
    }
    this.assertLive();
    if (signal?.aborted) throw cancelled();
    const now = new Date().toISOString(), controller = new AbortController();
    const abort = () => this.abort(task);
    const task: Task<TContext> = { context, controller, pending: targets && new Set(targets), detach: () => signal?.removeEventListener("abort", abort), state: {
      taskId: crypto.randomUUID(), bookId, mode, maxChapters: options.maxChapters, ...(retryOf ? { retryOf } : {}), revision: 0, status: "queued", createdAt: now, updatedAt: now,
    } };
    this.tasks.set(task.state.taskId, task);
    signal?.addEventListener("abort", abort, { once: true });
    const initial = structuredClone(task.state);
    // Register completion before execution can call back into host shutdown.
    const work = Promise.resolve().then(() => this.run(task, targets));
    task.settled = work;
    this.executions.add(work);
    void work.then(() => this.executions.delete(work), () => this.executions.delete(work));
    this.notify(task);
    return initial;
  }
  private async run(task: Task<TContext>, targets?: number[]) {
    try {
      task.controller.signal.throwIfAborted();
      const report = await this.execute({ bookId: task.state.bookId, rebuild: task.state.mode === "rebuild", maxChapters: task.state.maxChapters, targets,
        signal: task.controller.signal,
        onStarted: () => { if (!task.controller.signal.aborted) this.update(task, { status: "running" }); },
        onPlan: chapters => { if (active(task)) task.pending = new Set(chapters); },
        onChapterAttempted: chapter => {
          if (active(task) && task.pending?.delete(chapter)) task.pending.add(chapter);
        },
        onChapterCommitted: chapter => { if (active(task)) task.pending?.delete(chapter); },
        onReport: report => { this.update(task, { report: structuredClone(report) }); },
      }, task.context);
      const finalReport = structuredClone(report);
      this.update(task, task.controller.signal.aborted ? { status: "cancelled", errorCode: "memory/cancelled", report: finalReport }
        : { status: report.status === "complete" ? "completed" : report.status, report: finalReport });
    } catch (error) {
      const code = task.controller.signal.aborted ? "memory/cancelled" : errorCode(error) ?? "ai/unknown";
      if (!task.controller.signal.aborted) this.warn("Graph task failed", error);
      this.update(task, { status: task.controller.signal.aborted ? "cancelled" : "failed", errorCode: code });
    } finally { task.detach(); }
  }
  async get(bookId: string, taskId: string) { return structuredClone(this.lookup(bookId, taskId).state); }
  /** Host cleanup follows physical execution, including cancellation after dispatch. */
  whenSettled(bookId: string, taskId: string): Promise<void> {
    return this.lookup(bookId, taskId).settled ?? Promise.resolve();
  }
  async list(bookId: string) {
    this.assertLive(); validateClassificationBookId(bookId);
    return [...this.tasks.values()].filter(task => task.state.bookId === bookId).map(task => structuredClone(task.state));
  }
  private abort(task: Task<TContext>, context?: TContext) {
    if (!active(task) || task.controller.signal.aborted || task.state.status === "cancelling") return;
    task.feedbackContext = context ?? task.context;
    this.update(task, { status: "cancelling" });
    task.controller.abort(cancelled());
  }
  async cancel(bookId: string, taskId: string, context?: TContext) {
    const task = this.lookup(bookId, taskId); this.abort(task, context); return structuredClone(task.state);
  }
  async retry(bookId: string, taskId: string, options?: BookGraphTaskOptions, signal?: AbortSignal, context?: TContext) {
    const task = this.lookup(bookId, taskId);
    if (active(task) || task.state.status === "completed") throw new AppError("memory/conflict", "Only unfinished terminal tasks can be retried");
    // A failed rebuild can leave a valid OLD digest. Retain its target instead of treating it as repaired.
    return this.create(bookId, task.state.mode, normalizeBookGraphTaskOptions(options, task.state.maxChapters), taskId, task.pending ? [...task.pending] : undefined, signal, context);
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.listeners.clear();
    for (const task of this.tasks.values()) { task.detach(); this.abort(task); }
    this.tasks.clear();
  }

  /** Cancellation retires handles immediately; physical execution settles separately. */
  async drain(): Promise<void> {
    while (this.executions.size) await Promise.all([...this.executions]);
  }
}
