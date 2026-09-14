import { actorFromEvent, causalActor, copyEventCause, ObservationCauses, restoreActorSource, saveActorSource, stampEventCause, type DomainActor, type DurableActorSource } from "../../../platform/domain-actor";
import { AppError, errorCode, normalizeDeferredRequest, type PluginDeferredRequest, type PluginDeferredReceipt,
  type PluginScheduleRun, type PluginDeferredState, type PluginScheduleControl, type PluginSchedulePage, type PluginScheduleQuery,
  type PluginScheduleReceipt, type PluginScheduleState } from "@read-aware/core";
import { MIN_SCHEDULE_MINUTES, type PluginScheduleDeclaration } from "@read-aware/plugin-types";
import { publishContributionChange, undoContributionReplacement } from "../state/contribution-activation";

export type ScheduleRecord = Pick<PluginScheduleState, "paused" | "lastStartedAt" | "lastFinishedAt" | "lastSuccessAt" | "lastOutcome" | "lastErrorCode" | "deferred"> & { deferredSource?: DurableActorSource };
type Task = { pluginId: string; version: string; declaration: PluginScheduleDeclaration; token: { disposed: boolean };
  run(context: PluginScheduleRun): void | Promise<void>; record: ScheduleRecord; active: boolean; writes?: number; flight?: Promise<PluginScheduleReceipt> };
type Storage = { read(pluginId: string): Record<string, ScheduleRecord>; write(pluginId: string, records: Record<string, ScheduleRecord>, origin?: DomainActor): Promise<void> };
const empty = (): ScheduleRecord => ({ paused: false, lastStartedAt: null, lastFinishedAt: null, lastSuccessAt: null, lastOutcome: null, lastErrorCode: null });
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 256;

export function isScheduleDue(lastRunIso: string | undefined, everyMinutes: number, nowMs: number): boolean {
  const last = lastRunIso ? Date.parse(lastRunIso) : NaN;
  return !Number.isFinite(last) || last > nowMs || nowMs - last >= Math.max(everyMinutes, MIN_SCHEDULE_MINUTES) * 60_000;
}

/** Cadence and manual runs share one flight; persisted attempts are not success stamps. */
export class PluginScheduleController {
  private tasks = new Map<string, Task>();
  private queues = new Map<string, Promise<unknown>>();
  private listeners = new Set<(source: object) => void>();
  private changes = new ObservationCauses();
  private sweepCursor?: string;
  private writeReservation?: Promise<void>;
  constructor(private storage: Storage, private report: (error: unknown) => void, private now = Date.now) {}
  get size() { return [...this.tasks.values()].filter(task => task.active).length; }
  inspect() { return [...this.tasks].filter(([, task]) => task.active).map(([key]) => key).sort(); }
  async drainWrites(pluginId: string) {
    while (this.queues.has(pluginId)) {
      // Failed writes already reject their command; draining waits for settlement.
      await this.queues.get(pluginId)!.catch(() => {});
    }
  }
  /** Do not join callback flights: one may be the caller requesting backup.
   * Drain admitted state writes, defer later completion patches, and recheck
   * their owner only when they can persist. New executions/controls reject. */
  async withPersistencePaused<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    this.assertWritable();
    const accepted = [...this.queues.values()];
    let release!: () => void;
    this.writeReservation = new Promise<void>(resolve => { release = resolve; });
    try {
      await Promise.allSettled(accepted);
      signal?.throwIfAborted();
      return await operation();
    } finally {
      this.writeReservation = undefined;
      release();
    }
  }
  private assertWritable(): void {
    if (this.writeReservation) throw new AppError("backup/busy", "Schedule persistence is paused for backup");
  }
  subscribe(handler: (source: object) => void) { this.listeners.add(handler); return () => { this.listeners.delete(handler); }; }
  private changed(origin: DomainActor = "system") {
    this.changes.add(stampEventCause({}, origin));
    publishContributionChange(this, () => {
      const source = this.changes.take({});
      for (const handler of this.listeners) { try { handler(source); } catch (error) { this.report(error); } }
    });
  }
  register(pluginId: string, input: PluginScheduleDeclaration, run: Task["run"], version = "1.0.0", origin: DomainActor = "system") {
    origin = causalActor(origin);
    if (typeof pluginId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginId) || !input || typeof input.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)
      || typeof version !== "string" || !version || version.length > 128 || typeof input.label !== "string" || !input.label.trim() || input.label.length > 256
      || (input.mode === "deferred" ? input.everyMinutes !== undefined : input.mode !== undefined || !Number.isFinite(input.everyMinutes) || input.everyMinutes <= 0)
      || typeof run !== "function") throw new AppError("ui/invalid-target", "Invalid schedule declaration");
    const key = `${pluginId}:${input.id}`, old = this.tasks.get(key), token = { disposed: false };
    if (!old && this.tasks.size >= 1024) throw new AppError("plugin/busy", "Host schedule capacity is occupied");
    if (!old && [...this.tasks.values()].filter(task => task.pluginId === pluginId).length >= 64) throw new AppError("ui/unavailable", "Too many schedules for this plugin");
    const task: Task = old ?? { pluginId, version, declaration: input, token, run, record: structuredClone(this.storage.read(pluginId)[input.id] ?? empty()), active: true };
    const previous = old && { declaration: old.declaration, version: old.version, token: old.token, run: old.run, active: old.active };
    undoContributionReplacement(() => {
      if (task.token !== token || this.tasks.has(key) && this.tasks.get(key) !== task) return;
      if (previous) {
        Object.assign(task, previous, { active: previous.active && !previous.token.disposed });
      } else task.active = false;
      // Keep the shared in-flight execution/write state even when neither
      // binding survives; a later binding must not overlap the old callback.
      if (task.active || task.flight || task.writes) this.tasks.set(key, task);
      else this.tasks.delete(key);
      this.changed(origin);
    });
    Object.assign(task, { declaration: input.mode === "deferred" ? { ...input } : { ...input, everyMinutes: Math.max(input.everyMinutes, MIN_SCHEDULE_MINUTES) }, version, token, run, active: true });
    this.tasks.set(key, task); this.changed(origin);
    return { dispose: (retirement: DomainActor = "system") => {
      if (token.disposed) return;
      token.disposed = true;
      if (task.token !== token) return;
      task.active = false;
      if (!task.flight && !task.writes) this.tasks.delete(key);
      this.changed(retirement);
    } };
  }
  async defer(pluginId: string, id: string, raw: PluginDeferredRequest, signal?: AbortSignal, origin: DomainActor = "system"): Promise<PluginDeferredReceipt> {
    origin = causalActor(origin);
    const input = normalizeDeferredRequest(raw), task = this.deferredTask(pluginId, id), token = task.token;
    this.assertWritable();
    let result!: PluginDeferredReceipt;
    await this.save(task, () => {
      const previous = this.deferredSnapshot(task);
      if (previous?.requestId === input.requestId) {
        if (previous.delayMs !== input.delayMs || previous.when !== input.when) throw new AppError("ui/superseded", "Deferred request ID was reused with different input");
        result = { status: "retained", request: this.deferredSnapshot(task) }; return undefined;
      }
      if (previous?.state === "queued") throw new AppError("plugin/busy", "A deferred request is already queued");
      const request: PluginDeferredState = { ...input, ownerVersion: task.version, dueAt: this.now() + input.delayMs, state: "queued", errorCode: null };
      result = { status: "queued", request: { ...request } };
      return { deferred: request, deferredSource: saveActorSource(origin) };
    }, () => { signal?.throwIfAborted(); this.assertCurrent(task, token); }, origin);
    return result;
  }
  async cancelDeferred(pluginId: string, id: string, requestId: string, signal?: AbortSignal, origin: DomainActor = "system"): Promise<PluginDeferredReceipt> {
    origin = causalActor(origin);
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) throw new AppError("ui/invalid-target", "Invalid deferred request ID");
    const task = this.deferredTask(pluginId, id), token = task.token;
    this.assertWritable();
    let result!: PluginDeferredReceipt;
    await this.save(task, record => {
      if (record.deferred?.requestId !== requestId || record.deferred.state !== "queued") {
        result = { status: "not-queued", request: this.deferredSnapshot(task) }; return undefined;
      }
      const request: PluginDeferredState = { ...record.deferred, state: "cancelled", errorCode: "plugin/cancelled" };
      result = { status: "cancelled", request: { ...request } }; return { deferred: request };
    }, () => { signal?.throwIfAborted(); this.assertCurrent(task, token); }, origin);
    return result;
  }
  private deferredTask(pluginId: string, id: string): Task {
    if (!validId(pluginId) || !validId(id)) throw new AppError("ui/invalid-target", "Invalid deferred schedule identity");
    const task = this.tasks.get(`${pluginId}:${id}`);
    if (!task?.active || task.declaration.mode !== "deferred") throw new AppError("ui/unavailable", "Deferred schedule is not bound");
    return task;
  }
  list(query: PluginScheduleQuery = {}): PluginSchedulePage {
    if (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).some(key => !["pluginId", "offset", "limit"].includes(key))
      || (query.pluginId !== undefined && !validId(query.pluginId))) throw new AppError("ui/invalid-target", "Invalid schedule query");
    const offset = query.offset ?? 0, limit = query.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("ui/invalid-target", "Invalid schedule page");
    const tasks = [...this.tasks.values()].filter(task => task.active && (!query.pluginId || task.pluginId === query.pluginId))
      .sort((a, b) => `${a.pluginId}:${a.declaration.id}`.localeCompare(`${b.pluginId}:${b.declaration.id}`));
    const page = tasks.slice(offset, offset + limit);
    return { schedules: page.map(task => this.snapshot(task)), total: tasks.length, nextOffset: offset + page.length < tasks.length ? offset + page.length : null };
  }
  observe(query: PluginScheduleQuery, handler: (page: PluginSchedulePage) => unknown, origin: DomainActor = "system") {
    const accepted = { ...query }; this.list(accepted);
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many schedule observers");
    const causes = new ObservationCauses(causalActor(origin));
    let retry: object | undefined, delivered: string | undefined;
    let disposed = false, running = false, dirty = false;
    const publish = async () => {
      dirty = true; if (running || disposed) return;
      running = true;
      try {
        do {
          dirty = false;
          try {
            const page = causes.take(this.list(accepted), retry), identity = JSON.stringify(page);
            if (identity !== delivered) {
              retry = copyEventCause(page, {});
              await handler(page);
              delivered = identity;
            }
            retry = undefined;
          } catch (error) { this.report(error); }
        } while (dirty && !disposed);
      } finally { running = false; }
    };
    const off = this.subscribe(source => { causes.add(source); void publish(); }); void publish();
    return () => { disposed = true; off(); };
  }
  async control(input: PluginScheduleControl, signal?: AbortSignal, origin: DomainActor = "system"): Promise<PluginScheduleReceipt> {
    origin = causalActor(origin);
    signal?.throwIfAborted();
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["pluginId", "id", "action"].includes(key))
      || !validId(input.pluginId) || !validId(input.id) || !["pause", "resume", "run"].includes(input.action)) throw new AppError("ui/invalid-target", "Invalid schedule control");
    const task = this.tasks.get(`${input.pluginId}:${input.id}`);
    if (!task?.active) throw new AppError("ui/unavailable", "Schedule is not bound");
    this.assertWritable();
    if (input.action === "run") return this.execute(task, "manual", signal, origin);
    const token = task.token;
    await this.save(task, { paused: input.action === "pause" }, () => {
      signal?.throwIfAborted(); this.assertCurrent(task, token);
    }, origin);
    signal?.throwIfAborted(); this.assertCurrent(task, token);
    return { status: "completed", schedule: this.snapshot(task) };
  }
  sweep(idle = false) {
    if (this.writeReservation) return;
    const now = this.now();
    const entries = [...this.tasks], start = (entries.findIndex(([key]) => key === this.sweepCursor) + 1) % Math.max(entries.length, 1);
    for (let offset = 0; offset < entries.length; offset++) {
      const [key, task] = entries[(start + offset) % entries.length]!;
      if (!task.active || task.flight || task.record.paused || !this.capacity(task)) continue;
      if (task.declaration.mode === "deferred") {
        const pending = this.deferredSnapshot(task);
        if (pending?.state === "queued" && pending.dueAt <= now && (pending.when === "any" || idle)) {
          this.sweepCursor = key;
          void this.execute(task, "deferred").catch(this.report);
        }
        continue;
      }
      const stamp = task.record.lastStartedAt;
      if (isScheduleDue(stamp === null ? undefined : new Date(stamp).toISOString(), task.declaration.everyMinutes, now)) {
        this.sweepCursor = key;
        void this.execute(task, "periodic").catch(this.report);
      }
    }
  }
  private async execute(task: Task, trigger: PluginScheduleRun["trigger"], signal?: AbortSignal, origin?: DomainActor): Promise<PluginScheduleReceipt> {
    origin = causalActor(origin ?? (trigger === "deferred" && task.record.deferredSource ? restoreActorSource("system", task.record.deferredSource) : "system"));
    this.assertWritable();
    if (task.flight) return { status: "already-running", schedule: this.snapshot(task) };
    if (!this.capacity(task)) throw new AppError("plugin/busy", "Schedule execution capacity is occupied");
    signal?.throwIfAborted();
    const token = task.token, run = task.run;
    const observed = this.deferredSnapshot(task);
    const deferred = task.declaration.mode === "deferred" && observed?.state === "queued" ? observed : null;
    const context = stampEventCause<PluginScheduleRun>({ trigger, requestId: deferred?.requestId ?? null, startedAt: this.now() }, origin);
    const deferredPatch = (record: ScheduleRecord, state: PluginDeferredState["state"], code: string | null) =>
      deferred && record.deferred?.requestId === deferred.requestId ? { deferred: { ...record.deferred, state, errorCode: code } } : {};
    const work = Promise.resolve().then(async () => {
      await this.save(task, record => {
        if (deferred && (record.deferred?.requestId !== deferred.requestId || record.deferred.state !== "queued")) throw new AppError("plugin/cancelled", "Deferred request changed before dispatch");
        return { lastStartedAt: context.startedAt, lastOutcome: "running", lastErrorCode: null, ...deferredPatch(record, "running", null) };
      }, () => {
        signal?.throwIfAborted(); this.assertCurrent(task, token);
      }, origin);
      try {
        signal?.throwIfAborted(); this.assertCurrent(task, token);
        try { await run(context); } finally { origin = actorFromEvent(context); }
        signal?.throwIfAborted(); this.assertCurrent(task, token);
      } catch (error) {
        const cancelled = signal?.aborted || !task.active || task.token !== token || errorCode(error) === "plugin/cancelled";
        const code = cancelled ? "plugin/cancelled" : errorCode(error) ?? "ipc/unknown";
        this.report(error);
        if (task.active && task.token === token) {
          await this.save(task, record => ({ lastFinishedAt: this.now(), lastOutcome: cancelled ? "cancelled" : "failed", lastErrorCode: code,
            ...deferredPatch(record, cancelled ? "cancelled" : "failed", code) }), () => this.assertCurrent(task, token), origin);
        }
        throw new AppError(code, "Plugin schedule callback did not complete");
      }
      await this.save(task, record => ({ lastFinishedAt: this.now(), lastSuccessAt: this.now(), lastOutcome: "succeeded", lastErrorCode: null,
        ...deferredPatch(record, "succeeded", null) }), () => this.assertCurrent(task, token), origin);
      signal?.throwIfAborted(); this.assertCurrent(task, token);
      return { status: "completed" as const, schedule: this.snapshot(task) };
    });
    task.flight = work; this.changed(origin);
    try { const receipt = await work; return { ...receipt, schedule: { ...receipt.schedule, running: false } }; }
    finally {
      task.flight = undefined;
      if (!task.active && !task.writes) this.tasks.delete(`${task.pluginId}:${task.declaration.id}`);
      this.changed(origin);
    }
  }
  private save(task: Task, patch: Partial<ScheduleRecord> | ((record: ScheduleRecord) => Partial<ScheduleRecord> | undefined), guard?: () => void, origin: DomainActor = "system"): Promise<void> {
    origin = causalActor(origin);
    task.writes = (task.writes ?? 0) + 1;
    const previous = this.queues.get(task.pluginId) ?? Promise.resolve();
    const reservation = this.writeReservation;
    // A failed write rejects its caller, but must not poison later control attempts.
    const work = previous.catch(() => {}).then(async () => {
      if (reservation) await reservation;
      guard?.();
      const update = typeof patch === "function" ? patch(task.record) : patch;
      if (!update) return;
      const records = this.storage.read(task.pluginId), next = { ...task.record, ...update };
      records[task.declaration.id] = next;
      await this.storage.write(task.pluginId, records, origin);
      task.record = next; this.changed(origin);
    });
    this.queues.set(task.pluginId, work);
    // Cleanup observes rejection only to avoid an unhandled derivative promise.
    void work.finally(() => {
      task.writes = (task.writes ?? 1) - 1;
      if (!task.active && !task.flight && !task.writes) this.tasks.delete(`${task.pluginId}:${task.declaration.id}`);
      if (this.queues.get(task.pluginId) === work) this.queues.delete(task.pluginId);
    }).catch(() => {});
    return work;
  }
  private assertCurrent(task: Task, token: object) {
    if (!task.active || task.token !== token || this.tasks.get(`${task.pluginId}:${task.declaration.id}`) !== task) throw new AppError("plugin/cancelled", "Schedule owner retired");
  }
  private snapshot(task: Task): PluginScheduleState {
    const { deferredSource: _source, ...record } = task.record;
    return { pluginId: task.pluginId, id: task.declaration.id, label: task.declaration.label, everyMinutes: task.declaration.everyMinutes ?? null,
      ...record, deferred: this.deferredSnapshot(task), running: !!task.flight,
      lastOutcome: !task.flight && task.record.lastOutcome === "running" ? "interrupted" : task.record.lastOutcome };
  }
  private deferredSnapshot(task: Task): PluginDeferredState | null {
    const request = task.record.deferred;
    if (request?.state === "queued" && (request.ownerVersion !== task.version || task.declaration.mode !== "deferred")) return { ...request, state: "cancelled", errorCode: "ui/superseded" };
    return request ? { ...request, state: !task.flight && request.state === "running" ? "interrupted" : request.state } : null;
  }
  private capacity(task: Task): boolean {
    let total = 0, own = 0;
    for (const candidate of this.tasks.values()) if (candidate.flight) { total++; if (candidate.pluginId === task.pluginId) own++; }
    return total < 8 && own < 2;
  }
}
