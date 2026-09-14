import { AppError, errorCode, assertOperationConditions, normalizeBookTextPrepareOptions, type OperationCondition, type BookTextPriority, type BookTextPrepareOptions, type BookTextTaskSnapshot } from "@read-aware/core";
import type { ResourceAccess } from "../../../services/resource-access";
import type { BookTextTaskHistory } from "./book-text-task-history";
import type { BookTextRepository } from "./book-text-repository";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";

type Listener = (state: BookTextTaskSnapshot) => void | Promise<void>;
type Observer = { send(state: BookTextTaskSnapshot): void; stop(): void };
type Task = { releaseAccess?: () => void; source: { origin: DomainActor; cancellationOrigin?: DomainActor }; admitted: boolean; lastHistoryRevision?: number; timer?: ReturnType<typeof setTimeout>; state: BookTextTaskSnapshot; controller: AbortController; rebuildPending: boolean; observers: Set<Observer> };
const active = (state: BookTextTaskSnapshot) => state.status === "queued" || state.status === "running" || state.status === "paused";
const cancelled = () => new AppError("library/text-cancelled", "This text preparation request was cancelled");

/** Per-actor-generation task handles. Each request leases the shared repository work. */
export class BookTextTaskOwner {
  private readonly tasks = new Map<string, Task>();
  private stopped = false;
  constructor(private readonly repository: Pick<BookTextRepository, "snapshot" | "prepare"> & Partial<Pick<BookTextRepository, "preparationConditions">>,
    private readonly warn: (message: string, error: unknown) => void,
    lifetime?: AbortSignal, private readonly history?: BookTextTaskHistory) {
    if (lifetime?.aborted) this.dispose();
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }

  private assertLive() { if (this.stopped) throw cancelled(); }
  private capacityConditions(): OperationCondition[] {
    // Querying must not expire tasks, persist history, or dispatch callbacks.
    const full = [...this.tasks.values()].filter(task => active(task.state) && Date.now() < Date.parse(task.state.deadlineAt)).length >= 16;
    return [{ kind: "capacity", state: full ? "unavailable" : "satisfied", reason: full ? "text-task-limit" : "text-task-capacity",
      ...(full ? { errorCode: "library/text-task-limit" } : {}) }];
  }

  async conditions(bookId: string, options: BookTextPrepareOptions = {}, signal?: AbortSignal): Promise<OperationCondition[]> {
    const request = normalizeBookTextPrepareOptions(options);
    this.assertLive(); signal?.throwIfAborted();
    const capacity = this.capacityConditions();
    if (capacity[0]!.state === "unavailable") return capacity;
    const conditions = await this.repository.preparationConditions?.(bookId, request.rebuild, signal)
      ?? [{ kind: "provider" as const, state: "unknown" as const, reason: "text-prerequisites-unavailable" }];
    this.assertLive(); signal?.throwIfAborted();
    return [...this.capacityConditions(), ...conditions];
  }
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
    if (!active(task.state)) { clearTimeout(task.timer); task.timer = undefined; task.releaseAccess?.(); task.releaseAccess = undefined; }
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

  async start(bookId: string, options: BookTextPrepareOptions = {}, origin: DomainActor = "system", access?: ResourceAccess): Promise<BookTextTaskSnapshot> {
    try { return await this.startAuthorized(bookId, options, origin, access); }
    catch (error) { access?.dispose(); throw error; }
  }

  private async startAuthorized(bookId: string, options: BookTextPrepareOptions, origin: DomainActor, access?: ResourceAccess): Promise<BookTextTaskSnapshot> {
    const actor = causalActor(origin);
    const check = () => {
      this.assertLive(); access?.signal.throwIfAborted();
      if (access && !access.isAllowed()) throw new AppError("plugin/object-access-denied", "Text task authorization expired");
    };
    check();
    const request = normalizeBookTextPrepareOptions(options);
    if (this.repository.preparationConditions) assertOperationConditions(await this.conditions(bookId, request, access?.signal));
    check();
    const state = await this.repository.snapshot(bookId);
    check();
    for (const task of this.tasks.values()) this.expire(task);
    assertOperationConditions(this.capacityConditions());
    // Retain at most 64 handles. Eviction closes observers of oldest terminal requests.
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task.state)) { for (const observer of task.observers) observer.stop(); this.tasks.delete(id); }
    }
    // Expiring an older task can synchronously notify a consumer that changes
    // the reader. Recheck before adding this request or writing its history.
    check();
    const now = new Date().toISOString(), deadlineAt = new Date(Date.parse(now) + request.timeoutMs).toISOString();
    const task: Task = { source: { origin: actor }, admitted: false, controller: new AbortController(), rebuildPending: request.rebuild, observers: new Set(), state: {
      taskId: crypto.randomUUID(), bookId, mode: request.rebuild ? "rebuild" : "prepare", revision: 0,
      status: "queued", priority: request.priority, timeoutMs: request.timeoutMs, deadlineAt, waitReason: null, createdAt: now, updatedAt: now, textState: state,
    } };
    this.tasks.set(task.state.taskId, task);
    if (access) {
      const abort = () => { if (!this.stopped) this.cancel(bookId, task.state.taskId); };
      task.releaseAccess = () => { access.signal.removeEventListener("abort", abort); access.dispose(); };
      access.signal.addEventListener("abort", abort, { once: true });
    }
    try { await this.history?.record(task.state); }
    catch (error) { task.releaseAccess?.(); this.tasks.delete(task.state.taskId); throw error; }
    // A scope change while the initial history write drains cancels this lease.
    // Its accepted metadata remains truthful; extraction has not been dispatched.
    check(); this.expire(task); task.admitted = true;
    if (active(task.state)) {
      this.scheduleDeadline(task);
      if (task.state.status === "queued") void this.run(task);
    }
    return structuredClone(task.state);
  }

  private async run(task: Task): Promise<void> {
    const controller = task.controller, source = task.source;
    const current = () => { this.expire(task); return task.controller === controller && !controller.signal.aborted && task.state.status === "running"; };
    this.publish(task, { status: "running", errorCode: undefined, waitReason: null });
    try {
      const textState = await this.repository.prepare(task.state.bookId, {
        origin: source.origin, cancellationOrigin: () => source.cancellationOrigin,
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
  pause(bookId: string, taskId: string, origin?: DomainActor): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (task.state.status === "queued" || task.state.status === "running") {
      task.source.cancellationOrigin = origin === undefined ? task.source.origin : causalActor(origin);
      this.publish(task, { status: "paused", waitReason: null, errorCode: undefined });
      task.controller.abort(new AppError("library/text-cancelled", "Text request paused"));
    }
    return structuredClone(task.state);
  }

  resume(bookId: string, taskId: string, origin?: DomainActor): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (task.state.status === "paused") {
      task.source = { origin: origin === undefined ? task.source.origin : causalActor(origin) };
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
  cancel(bookId: string, taskId: string, origin?: DomainActor): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (active(task.state)) {
      task.source.cancellationOrigin = origin === undefined ? task.source.origin : causalActor(origin);
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
