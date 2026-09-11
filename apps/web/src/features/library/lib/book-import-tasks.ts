import { AppError, errorCode, type BookImportPhase, type BookImportReceipt, type BookImportTaskSnapshot } from "@read-aware/core";

type Observer = { send(snapshot: BookImportTaskSnapshot): void; stop(): void };
type Task = { snapshot: BookImportTaskSnapshot; controller: AbortController; observers: Set<Observer> };
type Execute = (signal: AbortSignal, progress: (phase: BookImportPhase) => void) => Promise<BookImportReceipt>;
const active = (task: Task) => !["completed", "cancelled", "failed"].includes(task.snapshot.phase);
const cancelled = () => new AppError("ui/superseded", "Import task cancelled");
let activeImports = 0;

/** Import-specific actor handles. Limits count physical executions until they settle. */
export class BookImportTaskOwner {
  private readonly tasks = new Map<string, Task>();
  private readonly executions = new Set<Promise<void>>();
  private readonly retirement = new AbortController();
  private stopped = false;
  constructor(private readonly report: (error: unknown) => void, lifetime?: AbortSignal) {
    if (lifetime?.aborted) this.stopped = true;
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }
  private assertLive() { if (this.stopped) throw cancelled(); }
  private lookup(id: string) {
    this.assertLive();
    const task = this.tasks.get(id);
    if (!task) throw new AppError("ui/invalid-target", "No import task belongs to this actor");
    return task;
  }
  start(sourceName: string, execute: Execute): BookImportTaskSnapshot {
    this.assertLive();
    if (typeof sourceName !== "string" || !sourceName || sourceName.length > 256) throw new AppError("ui/invalid-target", "Invalid import filename");
    if (this.executions.size >= 2 || activeImports >= 4) throw new AppError("ui/unavailable", "Import execution capacity is occupied");
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task)) { for (const observer of task.observers) observer.stop(); this.tasks.delete(id); }
    }
    const now = new Date().toISOString();
    const task: Task = { controller: new AbortController(), observers: new Set(), snapshot: {
      taskId: crypto.randomUUID(), sourceName, phase: "queued", revision: 0, createdAt: now, updatedAt: now,
      cancellable: true, cancelRequested: false, receipt: null, errorCode: null,
    } };
    this.tasks.set(task.snapshot.taskId, task);
    // Reserve before any callback can reenter start/dispose.
    activeImports++;
    const work = Promise.resolve().then(() => this.run(task, execute));
    this.executions.add(work);
    const release = () => { activeImports--; this.executions.delete(work); };
    void work.then(release, error => { release(); this.report(error); });
    return structuredClone(task.snapshot);
  }
  private publish(task: Task, change: Partial<BookImportTaskSnapshot>) {
    if (!active(task)) return;
    task.snapshot = { ...task.snapshot, ...change, revision: task.snapshot.revision + 1, updatedAt: new Date().toISOString() };
    for (const observer of task.observers) observer.send(task.snapshot);
  }
  private async run(task: Task, execute: Execute) {
    try {
      task.controller.signal.throwIfAborted();
      const receipt = await execute(task.controller.signal, phase => {
        const order = { queued: 0, preparing: 1, staging: 2, committing: 3, completed: 4, cancelled: 4, failed: 4 };
        if (order[phase] > order[task.snapshot.phase]) this.publish(task, { phase, cancellable: phase === "preparing" });
      });
      this.publish(task, { phase: "completed", cancellable: false, receipt: structuredClone(receipt) });
    } catch (error) {
      const wasCancelled = task.snapshot.cancellable && task.controller.signal.aborted && error === task.controller.signal.reason;
      if (!wasCancelled) this.report(error);
      this.publish(task, { phase: wasCancelled ? "cancelled" : "failed", cancellable: false,
        errorCode: wasCancelled ? "ui/superseded" : errorCode(error) ?? "internal" });
    }
  }
  get(id: string): BookImportTaskSnapshot { return structuredClone(this.lookup(id).snapshot); }
  /** Bounded terminal wait. Cancelling observation never cancels the import. */
  wait(id: string, waitMs = 0, signal?: AbortSignal): Promise<BookImportTaskSnapshot> {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30_000) throw new AppError("ui/invalid-target", "Invalid import wait duration");
    signal?.throwIfAborted();
    const task = this.lookup(id);
    if (!waitMs || !active(task)) return Promise.resolve(this.get(id));
    const lifetime = signal ? AbortSignal.any([signal, this.retirement.signal]) : this.retirement.signal;
    return new Promise((resolve, reject) => {
      let settled = false, off = () => {};
      const finish = (value?: BookImportTaskSnapshot, error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); off(); lifetime.removeEventListener("abort", abort);
        if (value) resolve(value); else reject(error);
      };
      const timer = setTimeout(() => {
        try { finish(this.get(id)); } catch (error) { finish(undefined, error); }
      }, waitMs);
      const abort = () => finish(undefined, lifetime.reason);
      lifetime.addEventListener("abort", abort, { once: true });
      try { off = this.observe(id, snapshot => { if (!active(task)) finish(snapshot); }); }
      catch (error) { finish(undefined, error); }
      if (settled) off();
    });
  }
  list(): BookImportTaskSnapshot[] { this.assertLive(); return [...this.tasks.values()].map(task => structuredClone(task.snapshot)); }
  cancel(id: string): BookImportTaskSnapshot {
    const task = this.lookup(id);
    this.requestCancel(task);
    return structuredClone(task.snapshot);
  }
  private requestCancel(task: Task): void {
    if (active(task) && !task.controller.signal.aborted) {
      task.controller.abort(cancelled());
      this.publish(task, { cancelRequested: true });
    }
  }
  observe(id: string, handler: (snapshot: BookImportTaskSnapshot) => unknown): () => void {
    const task = this.lookup(id);
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected an import observer");
    if (task.observers.size >= 16) throw new AppError("ui/observer-limit", "Too many import observers");
    let stopped = false, running = false, latest: BookImportTaskSnapshot | undefined;
    const observer: Observer = {
      send: snapshot => { if (!stopped) { latest = structuredClone(snapshot); if (!running) void publish(); } },
      stop: () => { stopped = true; latest = undefined; task.observers.delete(observer); },
    };
    const publish = async () => {
      running = true;
      try {
        while (!stopped && latest) {
          const value = latest; latest = undefined;
          try { await handler(value); } catch (error) { this.report(error); }
        }
      } finally { running = false; }
    };
    task.observers.add(observer); observer.send(task.snapshot); return observer.stop;
  }
  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.retirement.abort(cancelled());
    for (const task of this.tasks.values()) {
      for (const observer of task.observers) observer.stop();
      this.requestCancel(task);
    }
    this.tasks.clear();
  }
  async drain(): Promise<void> { while (this.executions.size) await Promise.all([...this.executions]); }
}
