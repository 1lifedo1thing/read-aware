import { AppError, errorCode, type BookTextPriority, type BookTextPrepareOptions, type BookTextTaskSnapshot } from "@read-aware/core";
import type { BookTextTaskHistory } from "./book-text-task-history";
import type { BookTextRepository } from "./book-text-repository";

type Listener = (state: BookTextTaskSnapshot) => void | Promise<void>;
type Observer = { send(state: BookTextTaskSnapshot): void; stop(): void };
type Task = { admitted: boolean; lastHistoryRevision?: number; timer?: ReturnType<typeof setTimeout>; state: BookTextTaskSnapshot; controller: AbortController; rebuildPending: boolean; observers: Set<Observer> };
const active = (state: BookTextTaskSnapshot) => state.status === "queued" || state.status === "running" || state.status === "paused";
const cancelled = () => new AppError("library/text-cancelled", "This text preparation request was cancelled");

/** Per-actor-generation task handles. Each request leases the shared repository work. */
export class BookTextTaskOwner {
  private readonly tasks = new Map<string, Task>();
  private stopped = false;
  constructor(private readonly repository: Pick<BookTextRepository, "snapshot" | "prepare">,
    private readonly warn: (message: string, error: unknown) => void,
    lifetime?: AbortSignal, private readonly history?: BookTextTaskHistory) {
    if (lifetime?.aborted) this.dispose();
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }

  private assertLive() { if (this.stopped) throw cancelled(); }
  private lookup(bookId: string, taskId: string): Task {
    this.assertLive();
    const task = this.tasks.get(taskId);
    if (!task || task.state.bookId !== bookId) throw new AppError("library/text-task-not-found", "No task belongs to this actor and book");
    this.expire(task);
    return task;
  }
  private publish(task: Task, change: Partial<Pick<BookTextTaskSnapshot, "status" | "textState" | "errorCode" | "priority" | "waitReason">>) {
    if (!active(task.state)) return;
    task.state = { ...task.state, ...change, revision: task.state.revision + 1, updatedAt: new Date().toISOString() };
    if (!active(task.state)) { clearTimeout(task.timer); task.timer = undefined; }
    if (change.status !== undefined || change.priority !== undefined) this.record(task);
    for (const observer of task.observers) observer.send(task.state);
  }

  private historySettled(task: Task, revision: number, error?: unknown): void {
    if (this.stopped || task.lastHistoryRevision !== revision) return;
    task.state = { ...task.state, revision: task.state.revision + 1,
      history: error === undefined ? { status: "saved", persistedRevision: revision }
        : { status: "failed", errorCode: errorCode(error) ?? "db/error" } };
    for (const observer of task.observers) observer.send(task.state);
  }

  private record(task: Task): void {
    if (!this.history) return;
    const revision = task.state.revision; task.lastHistoryRevision = revision;
    task.state = { ...task.state, history: { status: "pending" } };
    const failed = (error: unknown) => { this.warn("Text task history write failed", error); this.historySettled(task, revision, error); };
    try { void this.history.record(task.state).then(() => this.historySettled(task, revision), failed); }
    catch (error) { failed(error); }
  }

  async listHistory(bookId: string, query?: import("@read-aware/core").BookTextTaskHistoryQuery): Promise<import("@read-aware/core").BookTextTaskHistoryPage> {
    this.assertLive();
    for (const task of this.tasks.values()) this.expire(task);
    if (!this.history) return { items: [], total: 0, nextOffset: null, retainedLimit: 64 };
    const result = await this.history.list(bookId, query, id => this.tasks.has(id));
    this.assertLive();
    for (const entry of result.items) {
      const task = this.tasks.get(entry.snapshot.taskId);
      if (entry.requestAvailable && task?.lastHistoryRevision !== undefined
        && entry.snapshot.revision >= task.lastHistoryRevision && task.state.history?.status !== "saved") this.historySettled(task, task.lastHistoryRevision);
    }
    return result;
  }

  private expire(task: Task): void {
    if (!active(task.state) || Date.now() < Date.parse(task.state.deadlineAt)) return;
    const error = new AppError("library/text-timeout", "Text request deadline elapsed", { retryable: true });
    this.publish(task, { status: "failed", waitReason: null, errorCode: error.code });
    task.controller.abort(error);
  }

  private scheduleDeadline(task: Task): void {
    task.timer = setTimeout(() => {
      task.timer = undefined; this.expire(task);
      // A wall-clock correction can move the visible deadline farther away.
      if (active(task.state)) this.scheduleDeadline(task);
    }, Math.min(2_147_483_647, Math.max(0, Date.parse(task.state.deadlineAt) - Date.now())));
    if (typeof task.timer === "object" && "unref" in task.timer) task.timer.unref();
  }

  async start(bookId: string, options: BookTextPrepareOptions = {}): Promise<BookTextTaskSnapshot> {
    this.assertLive();
    if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some(key => !["rebuild", "priority", "timeoutMs"].includes(key)) || options.rebuild !== undefined && typeof options.rebuild !== "boolean"
      || options.priority !== undefined && options.priority !== "normal" && options.priority !== "background") {
      throw new AppError("library/invalid-input", "Invalid text preparation options");
    }
    const timeoutMs = options.timeoutMs === undefined ? 30 * 60_000 : options.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 2 * 60 * 60_000) {
      throw new AppError("library/invalid-input", "Text timeout must be 1000..7200000 milliseconds");
    }
    const request = { rebuild: options.rebuild, priority: options.priority ?? "normal", timeoutMs };
    const state = await this.repository.snapshot(bookId);
    this.assertLive();
    for (const task of this.tasks.values()) this.expire(task);
    if ([...this.tasks.values()].filter(task => active(task.state)).length >= 16) throw new AppError("library/text-task-limit", "Too many active text requests for this actor");
    // Retain at most 64 handles. Eviction closes observers of oldest terminal requests.
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task.state)) { for (const observer of task.observers) observer.stop(); this.tasks.delete(id); }
    }
    const now = new Date().toISOString(), deadlineAt = new Date(Date.parse(now) + request.timeoutMs).toISOString();
    const task: Task = { admitted: false, controller: new AbortController(), rebuildPending: request.rebuild === true, observers: new Set(), state: {
      taskId: crypto.randomUUID(), bookId, mode: request.rebuild ? "rebuild" : "prepare", revision: 0,
      status: "queued", priority: request.priority, timeoutMs: request.timeoutMs, deadlineAt, waitReason: null, createdAt: now, updatedAt: now, textState: state,
    } };
    this.tasks.set(task.state.taskId, task);
    try { await this.history?.record(task.state); }
    catch (error) { this.tasks.delete(task.state.taskId); throw error; }
    this.assertLive(); this.expire(task); task.admitted = true;
    if (active(task.state)) {
      this.scheduleDeadline(task);
      if (task.state.status === "queued") void this.run(task);
    }
    return structuredClone(task.state);
  }

  private async run(task: Task): Promise<void> {
    const controller = task.controller;
    const current = () => { this.expire(task); return task.controller === controller && !controller.signal.aborted && task.state.status === "running"; };
    this.publish(task, { status: "running", errorCode: undefined, waitReason: null });
    try {
      const textState = await this.repository.prepare(task.state.bookId, {
        rebuild: task.rebuildPending, signal: controller.signal,
        priority: () => task.state.priority,
        scheduling: reason => { if (current() && task.state.waitReason !== reason) this.publish(task, { waitReason: reason }); },
        onRebuildReset: () => { task.rebuildPending = false; },
        progress: textState => { if (current()) this.publish(task, { textState }); },
      });
      if (current()) this.publish(task, { status: "completed", waitReason: null, textState });
    } catch (error) {
      if (!current()) return;
      this.warn("Book text request failed", error);
      let textState = task.state.textState;
      try { textState = await this.repository.snapshot(task.state.bookId); }
      catch (readError) { this.warn("Failed to refresh text state after a request failure", readError); }
      if (current()) this.publish(task, { status: "failed", waitReason: null, errorCode: errorCode(error) ?? "library/text-extraction-failed", textState });
    }
  }

  /** Release only this lease. Other readers can continue; dispatched work may drain. */
  pause(bookId: string, taskId: string): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (task.state.status === "queued" || task.state.status === "running") {
      this.publish(task, { status: "paused", waitReason: null, errorCode: undefined });
      task.controller.abort(new AppError("library/text-cancelled", "Text request paused"));
    }
    return structuredClone(task.state);
  }

  resume(bookId: string, taskId: string): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (task.state.status === "paused") {
      task.controller = new AbortController();
      if (task.admitted) void this.run(task);
      else this.publish(task, { status: "queued" });
    }
    return structuredClone(task.state);
  }

  setPriority(bookId: string, taskId: string, priority: BookTextPriority): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (priority !== "normal" && priority !== "background") throw new AppError("library/invalid-input", "Invalid text priority");
    if (active(task.state) && task.state.priority !== priority) this.publish(task, { priority });
    return structuredClone(task.state);
  }

  get(bookId: string, taskId: string): BookTextTaskSnapshot { return structuredClone(this.lookup(bookId, taskId).state); }
  list(bookId: string): BookTextTaskSnapshot[] {
    this.assertLive();
    if (typeof bookId !== "string" || !bookId.trim()) throw new AppError("library/invalid-input", "A book ID is required");
    for (const task of this.tasks.values()) if (task.state.bookId === bookId) this.expire(task);
    return [...this.tasks.values()].filter(task => task.state.bookId === bookId).map(task => structuredClone(task.state));
  }
  cancel(bookId: string, taskId: string): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (active(task.state)) {
      this.publish(task, { status: "cancelled", waitReason: null, errorCode: "library/text-cancelled" });
      task.controller.abort(cancelled());
    }
    return structuredClone(task.state);
  }

  /** Immediate snapshot plus monotonic revisions; slow consumers coalesce to the latest snapshot. */
  observe(bookId: string, taskId: string, listener: Listener): () => void {
    const task = this.lookup(bookId, taskId);
    if (task.observers.size >= 16) throw new AppError("library/text-task-limit", "Too many observers of this task");
    if (typeof listener !== "function") throw new AppError("library/invalid-input", "A task observer is required");
    let stopped = false, delivering = false;
    let latest: BookTextTaskSnapshot | undefined;
    const observer: Observer = {
      send: state => {
        if (stopped) return;
        latest = structuredClone(state);
        if (!delivering) void deliver();
      },
      stop: () => { stopped = true; latest = undefined; task.observers.delete(observer); },
    };
    const deliver = async () => {
      delivering = true;
      try {
        while (!stopped && latest) {
          const value = latest; latest = undefined;
          try { await listener(value); }
          catch (error) { this.warn("Text task observer failed", error); }
        }
      } finally { delivering = false; }
    };
    task.observers.add(observer); observer.send(task.state);
    return observer.stop;
  }

  dispose(): void {
    if (this.stopped) return;
    // Stop delivery before aborting requests; no retired actor receives cancellation callbacks.
    for (const task of this.tasks.values()) {
      for (const observer of task.observers) observer.stop();
      if (active(task.state)) this.cancel(task.state.bookId, task.state.taskId);
    }
    this.stopped = true; this.tasks.clear();
  }
}
