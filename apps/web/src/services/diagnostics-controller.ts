import { causalActor, copyEventCause, eventCause, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { AppError, type OperationCondition, type HostDiagnosticsPort, type ProjectionVerification } from "@read-aware/core";

type Adapter = { supported(): boolean; verify(origin?: DomainActor): Promise<unknown>; requestReport(action: Parameters<HostDiagnosticsPort["requestReport"]>[0], signal?: AbortSignal, origin?: DomainActor): ReturnType<HostDiagnosticsPort["requestReport"]>;
  requestProjectionRepair?(signal?: AbortSignal, origin?: DomainActor): ReturnType<HostDiagnosticsPort["requestProjectionRepair"]> };

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError("db/error", "Invalid projection verification count");
  }
  return value;
}

export function projectionVerificationSummary(value: unknown): ProjectionVerification {
  if (!value || typeof value !== "object" || !("consistent" in value) || typeof value.consistent !== "boolean"
    || !("eventsReplayed" in value) || !("drift" in value) || !Array.isArray(value.drift)) {
    throw new AppError("db/error", "Invalid projection verification report");
  }
  let onlyLiveRows = 0, onlyReplayedRows = 0;
  for (const row of value.drift) {
    if (!row || typeof row !== "object" || !("onlyLive" in row) || !("onlyReplayed" in row)) {
      throw new AppError("db/error", "Invalid projection drift report");
    }
    onlyLiveRows = count(onlyLiveRows + count(row.onlyLive));
    onlyReplayedRows = count(onlyReplayedRows + count(row.onlyReplayed));
  }
  if (value.consistent !== (value.drift.length === 0) || value.drift.length > 0 && onlyLiveRows + onlyReplayedRows === 0) {
    throw new AppError("db/error", "Inconsistent projection verification report");
  }
  return { scope: "event-projections", checkedAt: new Date().toISOString(), consistent: value.consistent,
    eventsReplayed: count(value.eventsReplayed), driftedTables: value.drift.length, onlyLiveRows, onlyReplayedRows };
}

/** The native replay owns its lifetime; abandoned callers cannot start a second replay. */
export class HostDiagnosticsService implements HostDiagnosticsPort {
  private active: Promise<ProjectionVerification> | undefined;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {}

  async requestProjectionRepair(signal?: AbortSignal, origin: DomainActor = "user") {
    signal?.throwIfAborted();
    if (!this.adapter.supported() || !this.adapter.requestProjectionRepair) throw new AppError("ui/unavailable", "Projection repair requires desktop controls");
    try { return await this.adapter.requestProjectionRepair(signal, causalActor(origin)); }
    catch (error) {
      signal?.throwIfAborted();
      this.report(error);
      throw new AppError(error instanceof AppError ? error.code : "ipc/unknown", "Projection repair request failed");
    }
  }

  async requestReport(action: Parameters<HostDiagnosticsPort["requestReport"]>[0], signal?: AbortSignal, origin: DomainActor = "user") {
    signal?.throwIfAborted();
    if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Diagnostic reports require desktop");
    try { return await this.adapter.requestReport(action, signal, causalActor(origin)); }
    catch (error) {
      signal?.throwIfAborted();
      this.report(error);
      throw new AppError(error instanceof AppError ? error.code : "ipc/unknown", "Diagnostic report action failed");
    }
  }

  verificationConditions(): OperationCondition[] {
    if (!this.adapter.supported()) return [{ kind: "provider", state: "unavailable", reason: "projection-verification-unsupported", errorCode: "ui/unavailable" }];
    return [{ kind: "capacity", state: "satisfied", reason: this.active ? "projection-verification-shared" : "projection-verification-ready" },
      { kind: "object", state: "unknown", reason: "projection-log-completeness-not-checked" }];
  }

  verifyProjections(signal?: AbortSignal, origin: DomainActor = "user"): Promise<ProjectionVerification> {
    signal?.throwIfAborted();
    const blocked = this.verificationConditions().find(value => value.state === "unavailable");
    if (blocked) throw new AppError("ui/unavailable", blocked.reason);
    if (!this.active) {
      origin = causalActor(origin);
      this.active = Promise.resolve().then(() => this.adapter.verify(origin)).then(value => {
        const summary = projectionVerificationSummary(value);
        return value && typeof value === "object" && eventCause(value) ? copyEventCause(value, summary) : stampEventCause(summary, origin);
      })
        .catch(error => { this.report(error); throw error; }).finally(() => { this.active = undefined; });
    }
    const source = this.active;
    return new Promise((resolve, reject) => {
      const abort = () => { signal?.removeEventListener("abort", abort); reject(signal?.reason); };
      signal?.addEventListener("abort", abort, { once: true });
      source.then(result => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(signal.reason);
        else resolve(copyEventCause(result, { ...result }));
      }, error => { signal?.removeEventListener("abort", abort); reject(error); });
      if (signal?.aborted) abort();
    });
  }
}
