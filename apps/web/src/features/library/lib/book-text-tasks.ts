import { AppError, errorCode, type BookTextPriority, type BookTextPrepareOptions, type BookTextTaskSnapshot } from "@read-aware/core";
import type { BookTextRepository } from "./book-text-repository";

type Listener = (state: BookTextTaskSnapshot) => void | Promise<void>;
type Observer = { send(state: BookTextTaskSnapshot): void; stop(): void };
type Task = { state: BookTextTaskSnapshot; controller: AbortController; rebuildPending: boolean; observers: Set<Observer> };
const active = (state: BookTextTaskSnapshot) => state.status === "queued" || state.status === "running" || state.status === "paused";
const cancelled = () => new AppError("library/text-cancelled", "This text preparation request was cancelled");

/** Per-actor-generation task handles. Each request leases the shared repository work. */
export class BookTextTaskOwner {
  private readonly tasks = new Map<string, Task>();
  private stopped = false;
  constructor(private readonly repository: Pick<BookTextRepository, "snapshot" | "prepare">,
    private readonly warn: (message: string, error: unknown) => void,
    lifetime?: AbortSignal) {
    if (lifetime?.aborted) this.dispose();
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }

  private assertLive() { if (this.stopped) throw cancelled(); }
  private lookup(bookId: string, taskId: string): Task {
    this.assertLive();
    const task = this.tasks.get(taskId);
    if (!task || task.state.bookId !== bookId) throw new AppError("library/text-task-not-found", "No task belongs to this actor and book");
    return task;
  }
  private publish(task: Task, change: Partial<Pick<BookTextTaskSnapshot, "status" | "textState" | "errorCode" | "priority" | "waitReason">>) {
    if (!active(task.state)) return;
    task.state = { ...task.state, ...change, revision: task.state.revision + 1, updatedAt: new Date().toISOString() };
    for (const observer of task.observers) observer.send(task.state);
  }

  async start(bookId: string, options: BookTextPrepareOptions = {}): Promise<BookTextTaskSnapshot> {
    this.assertLive();
    if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some(key => !["rebuild", "priority"].includes(key)) || options.rebuild !== undefined && typeof options.rebuild !== "boolean"
      || options.priority !== undefined && options.priority !== "normal" && options.priority !== "background") {
      throw new AppError("library/invalid-input", "Invalid text preparation options");
    }
    const request = { rebuild: options.rebuild, priority: options.priority ?? "normal" };
    const state = await this.repository.snapshot(bookId);
    this.assertLive();
    if ([...this.tasks.values()].filter(task => active(task.state)).length >= 16) throw new AppError("library/text-task-limit", "Too many active text requests for this actor");
    // Retain at most 64 handles. Eviction closes observers of oldest terminal requests.
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task.state)) { for (const observer of task.observers) observer.stop(); this.tasks.delete(id); }
    }
    const now = new Date().toISOString();
    const task: Task = { controller: new AbortController(), rebuildPending: request.rebuild === true, observers: new Set(), state: {
      taskId: crypto.randomUUID(), bookId, mode: request.rebuild ? "rebuild" : "prepare", revision: 0,
      status: "queued", priority: request.priority, waitReason: null, createdAt: now, updatedAt: now, textState: state,
    } };
    this.tasks.set(task.state.taskId, task);
    void this.run(task);
    return structuredClone(task.state);
  }

  private async run(task: Task): Promise<void> {
    const controller = task.controller;
    const current = () => task.controller === controller && !controller.signal.aborted && task.state.status === "running";
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
      void this.run(task);
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
