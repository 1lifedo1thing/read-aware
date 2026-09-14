import { AppError, errorCode, normalizeDurableJobPlan, type DurableJobPlan, type DurableJobStep, type DurableJobSnapshot, type DurableJobControl } from "@read-aware/core";
import type { DurableJobStore, DurableJobRecord, DurableJobAttempt } from "../platform/durable-jobs";

type Outcome = { status: "complete"; receipt: unknown } | { status: "needs-attention"; code: string; settled?: boolean };
export type DurableJobExecutor = {
  authorize(plan: DurableJobPlan, signal: AbortSignal): Promise<{ assert(): void | Promise<void>; dispose(): void }>;
  /** Pure preparation only: persist its result before dispatching side effects. */
  prepare(step: DurableJobStep, dispatchId: string, signal: AbortSignal): Promise<unknown>;
  execute(step: DurableJobStep, attempt: DurableJobAttempt, signal: AbortSignal, checkpoint: (data: unknown) => Promise<void>): Promise<Outcome>;
  /** Unknown is never treated as absent. 'ready' requires positive evidence
   * that execution is safe (e.g. a frozen idempotent native transaction). */
  reconcile(step: DurableJobStep, attempt: DurableJobAttempt, signal: AbortSignal, explicitResume: boolean): Promise<Outcome | { status: "ready"; data: unknown }>;
  report(error: unknown): void;
};
type State = DurableJobRecord["state"];
type Flight = { controller: AbortController; promise: Promise<void>; request(action: "pause" | "cancel"): Promise<void> };
const terminal = (status: string) => status === "completed" || status === "cancelled";
export function durableJobSnapshot(record: DurableJobRecord): DurableJobSnapshot {
  const step = record.plan.steps[record.state.nextStep];
  return { id: record.id, title: record.plan.title, revision: record.revision, status: record.state.status,
    totalSteps: record.plan.steps.length, completedSteps: record.state.nextStep,
    activeStep: step ? { id: step.id, kind: step.kind } : null, errorCode: record.state.errorCode,
    createdAt: record.createdAt, updatedAt: record.updatedAt };
}

/** Fixed host pipelines, not persisted JavaScript continuations. The checkpoint
 * precedes dispatch, and all work settles before a pause/cancel is acknowledged. */
export class DurableJobRunner {
  private flights = new Map<string, Flight>();
  private closed = false;
  constructor(private readonly store: DurableJobStore, private readonly executor: DurableJobExecutor) {}
  async start(input: DurableJobPlan, signal?: AbortSignal): Promise<DurableJobSnapshot> {
    if (this.closed) throw new AppError("jobs/unavailable", "Job owner retired");
    const plan = normalizeDurableJobPlan(input), controller = new AbortController();
    const grant = await this.executor.authorize(plan, signal ?? controller.signal);
    try {
      signal?.throwIfAborted(); await grant.assert();
      const record = await this.store.create(crypto.randomUUID(), plan);
      this.launch(record.id, false); return durableJobSnapshot(record);
    } finally { grant.dispose(); }
  }
  /** Activation/startup may resume queued/running work only after the owner is
   * available again. Paused and uncertain work require explicit user control. */
  async recover(): Promise<void> {
    if (this.closed) return;
    for (let offset = 0; offset < 256; offset += 50) {
      const records = await this.store.list(offset, 50);
      for (const record of records) if (["queued", "running"].includes(record.state.status)) this.launch(record.id, false);
      if (records.length < 50) break;
    }
  }
  private launch(id: string, explicitResume: boolean): void {
    if (this.closed || this.flights.has(id) || this.flights.size >= 4) return;
    const controller = new AbortController();
    // Publish the flight before any async continuation can observe it.
    let install!: (request: Flight["request"]) => void;
    const ready = new Promise<Flight["request"]>(resolve => { install = resolve; });
    const flight: Flight = { controller, promise: Promise.resolve(), request: async action => (await ready)(action) };
    this.flights.set(id, flight);
    let settled = false;
    flight.promise = this.drive(id, controller.signal, explicitResume, install).then(() => { settled = true; }, error => this.executor.report(error)).finally(() => {
      // Also release controls if loading/authorization failed before installation.
      install(async () => {});
      this.flights.delete(id);
      // A storage failure must not turn a still-queued record into a hot retry loop.
      if (settled && !this.closed) void this.recover().catch(error => this.executor.report(error));
    });
  }
  private async drive(id: string, signal: AbortSignal, explicitResume: boolean, install: (request: Flight["request"]) => void): Promise<void> {
    let record = await this.store.get(id);
    if (terminal(record.state.status) || (!explicitResume && !["queued", "running"].includes(record.state.status))) return;
    let grant: Awaited<ReturnType<DurableJobExecutor["authorize"]>> | undefined;
    record.plan = normalizeDurableJobPlan(record.plan);
    explicitResume ||= record.state.resumeRequested === true;
    let writes = Promise.resolve();
    const save = (update: (state: State) => State) => {
      const writing = writes.then(async () => { const next = update(record.state); if (next !== record.state) record = await this.store.checkpoint(record, next); });
      // Failed persistence retires this writer; never dispatch after its failure.
      writes = writing;
      return writing;
    };
    install(async action => {
      await save(state => terminal(state.status) ? state : { ...state, requestedAction: state.requestedAction === "cancel" ? "cancel" : action });
      this.flights.get(id)?.controller.abort(new AppError("jobs/interrupted", `Job ${action} requested`));
    });
    const incomplete = async (outcome: Extract<Outcome, { status: "needs-attention" }>) => {
      await save(state => ({ ...state,
        status: outcome.settled && state.requestedAction === "cancel" ? "cancelled" : outcome.settled && state.requestedAction === "pause" ? "paused" : "needs-attention",
        attempt: outcome.settled && state.attempt ? { ...state.attempt, phase: "settled" } : state.attempt,
        errorCode: outcome.code,
      }));
    };
    const finishStep = async (receipt: unknown) => {
      const step = record.plan.steps[record.state.nextStep]!;
      const next = record.state.nextStep + 1;
      await save(state => ({ ...state, status: next === record.plan.steps.length ? "completed" : state.requestedAction === "cancel" ? "cancelled" : state.requestedAction === "pause" ? "paused" : "running",
        nextStep: next, attempt: null, results: [...state.results, { stepId: step.id, receipt }], errorCode: null }));
    };
    try {
      grant = await this.executor.authorize(record.plan, signal);
      while (!terminal(record.state.status) && record.state.nextStep < record.plan.steps.length) {
        signal.throwIfAborted(); await grant.assert();
        const step = record.plan.steps[record.state.nextStep]!;
        if (record.state.requestedAction === "cancel" && record.state.attempt?.phase === "settled") {
          await save(state => ({ ...state, status: "cancelled" })); return;
        }
        if (record.state.attempt && record.state.attempt.phase !== "prepared") {
          const outcome = await this.executor.reconcile(step, record.state.attempt, signal, explicitResume);
          if (outcome.status === "complete") { await finishStep(outcome.receipt); if (record.state.status === "paused") return; continue; }
          if (outcome.status === "needs-attention") { await incomplete(outcome); return; }
          if (record.state.requestedAction === "cancel") {
            await save(state => ({ ...state, status: "needs-attention", errorCode: "jobs/outcome-unknown" }));
            return;
          }
          await save(state => ({ ...state, status: "running", attempt: { ...state.attempt!, phase: "prepared", data: outcome.data }, errorCode: null }));
        }
        if (record.state.requestedAction) {
          await save(state => ({ ...state, status: state.requestedAction === "cancel" ? "cancelled" : "paused" }));
          return;
        }
        if (!record.state.attempt) {
          const dispatchId = crypto.randomUUID();
          const data = await this.executor.prepare(step, dispatchId, signal);
          signal.throwIfAborted(); await grant.assert();
          await save(state => ({ ...state, status: "running", attempt: { stepIndex: record.state.nextStep, dispatchId, phase: "prepared", data }, errorCode: null }));
        }
        signal.throwIfAborted(); await grant.assert();
        await save(state => signal.aborted || state.requestedAction ? state : ({ ...state, status: "running", resumeRequested: false, attempt: { ...state.attempt!, phase: "dispatching" } }));
        signal.throwIfAborted();
        if (record.state.requestedAction) throw new AppError("jobs/interrupted", "Job control requested");
        explicitResume = false;
        const outcome = await this.executor.execute(step, record.state.attempt!, signal, async data => {
          await save(state => ({ ...state, attempt: { ...state.attempt!, data: structuredClone(data) } }));
        });
        if (outcome.status !== "complete") { await incomplete(outcome); return; }
        await finishStep(outcome.receipt);
        if (record.state.status === "paused") return;
      }
      if (!terminal(record.state.status) && record.state.nextStep === record.plan.steps.length) await save(state => ({ ...state, status: "completed", errorCode: null }));
    } catch (error) {
      // A stale runner has lost its right to change the checkpoint. In
      // particular, it must not overwrite a newer owner's reconciliation.
      if (errorCode(error) === "jobs/conflict") throw error;
      const action = record.state.requestedAction;
      const uncertain = !!record.state.attempt && ["dispatching", "unknown"].includes(record.state.attempt.phase);
      await save(state => ({ ...state, status: uncertain ? "needs-attention" : action === "cancel" ? "cancelled" : action === "pause" || this.closed ? "paused" : "failed",
        attempt: uncertain ? { ...record.state.attempt!, phase: "unknown" } : record.state.attempt,
        errorCode: errorCode(error) ?? (signal.aborted ? "jobs/interrupted" : "jobs/step-failed") }));
    } finally { grant?.dispose(); }
  }
  private async visible(id: string): Promise<DurableJobRecord> {
    const record = await this.store.get(id);
    const grant = await this.executor.authorize(normalizeDurableJobPlan(record.plan), new AbortController().signal);
    try { await grant.assert(); return record; } finally { grant.dispose(); }
  }
  async get(id: string): Promise<DurableJobSnapshot> { return durableJobSnapshot(await this.visible(id)); }
  async control(id: string, action: DurableJobControl): Promise<DurableJobSnapshot> {
    if (this.closed) throw new AppError("jobs/unavailable", "Job owner retired");
    const visible = await this.visible(id);
    const flight = this.flights.get(id);
    if (flight) {
      if (action !== "resume") { await flight.request(action); await flight.promise; }
      return this.get(id);
    }
    const record = visible;
    if (terminal(record.state.status)) return durableJobSnapshot(record);
    if (action === "resume") {
      const queued = await this.store.checkpoint(record, { ...record.state, status: "queued", resumeRequested: true, requestedAction: record.state.requestedAction === "cancel" ? "cancel" : null, errorCode: null });
      this.launch(id, true); return durableJobSnapshot(queued);
    }
    return durableJobSnapshot(await this.store.checkpoint(record, { ...record.state, requestedAction: record.state.requestedAction === "cancel" ? "cancel" : action,
      status: record.state.attempt && ["dispatching", "unknown"].includes(record.state.attempt.phase) ? "needs-attention" : action === "cancel" ? "cancelled" : "paused" }));
  }
  async stop(): Promise<void> {
    this.closed = true;
    const flights = [...this.flights.values()];
    await Promise.allSettled(flights.map(async flight => {
      try { await flight.request("pause"); }
      finally { flight.controller.abort(new AppError("jobs/interrupted", "Job owner retired")); await flight.promise; }
    }));
  }
}
