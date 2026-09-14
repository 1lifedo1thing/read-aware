import { causalActor, copyEventCause, ObservationCauses, type DomainActor } from "../platform/domain-actor";
import { AppError, assertOperationConditions, type OperationCondition, type AccountResponse, type HostSyncAccount, type HostSyncPort, type HostSyncSnapshot } from "@read-aware/core";
import type { SyncStatusSnapshot } from "../platform/sync/sync-scheduler";

type Adapter = {
  supported(): boolean; busy(): boolean; epoch(): string; status(): SyncStatusSnapshot;
  subscribe(handler: (source: object) => void): () => void;
  backlog: HostSyncPort["backlog"]; account(): Promise<AccountResponse>;
  run(origin?: DomainActor): Promise<unknown | null>; openSettings(signal?: AbortSignal, origin?: DomainActor): Promise<unknown>;
  connectionOptions: HostSyncPort["connectionOptions"];
  requestFlow(request: Parameters<HostSyncPort["requestFlow"]>[0], signal?: AbortSignal, origin?: DomainActor): ReturnType<HostSyncPort["requestFlow"]>;
  conditions?(): Promise<OperationCondition[]>;
};
function quota(value: number | null): number | null {
  if (value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)) return value;
  throw new AppError("sync/server", "Invalid account quota response");
}
function count(value: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new AppError("sync/server", "Invalid sync count");
}

export class HostSyncService implements HostSyncPort {
  private revision = 0;
  private listeners = new Set<(source: object) => void>();
  private retirement = new AbortController();
  private unsubscribe: () => void;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {
    this.unsubscribe = adapter.subscribe(source => {
      this.revision++;
      for (const listener of this.listeners) listener(source);
    });
  }
  dispose() { this.retirement.abort(); this.unsubscribe(); this.listeners.clear(); }
  async snapshot(): Promise<HostSyncSnapshot> {
    const state = this.adapter.status(), p = state.progress, last = state.lastCycle;
    return copyEventCause(state, { revision: this.revision, supported: this.adapter.supported(), connectionBusy: this.adapter.busy(),
      state: state.state, connected: state.accountConnected, backend: state.backend,
      lastSyncAt: state.lastSyncAt, lastErrorCode: state.lastErrorCode,
      progress: p ? { phase: p.phase, pulled: p.pulled, pushed: p.pushed, verified: p.verified,
        backfilled: p.backfilled, blobsDone: p.blobsDone, blobsTotal: p.blobsTotal } : null,
      cycleStartBacklog: state.cycleTotals ? { events: state.cycleTotals.events, blobs: state.cycleTotals.blobs } : null,
      lastCycle: last ? { pulled: last.pulled, pushed: last.pushed, blobs: last.blobs, backfilled: last.backfilled ?? 0 } : null,
      backfillRemaining: state.backfillRemaining });
  }
  observe(handler: (snapshot: HostSyncSnapshot) => unknown, origin?: DomainActor) {
    this.retirement.signal.throwIfAborted();
    const causes = new ObservationCauses(causalActor(origin ?? "system"));
    let retry: object | undefined;
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many sync observers");
    let stopped = false, running = false, dirty = false;
    const deliver = async () => {
      dirty = true; if (running || stopped) return;
      running = true;
      try {
        do {
          dirty = false;
          try {
            const revision = causes.revision, snapshot = await this.snapshot();
            if (stopped) return;
            if (revision !== causes.revision) { dirty = true; continue; }
            const value = causes.take(snapshot, retry); retry = copyEventCause(value, {});
            await handler(value); retry = undefined;
          }
          catch (error) { this.report(error); }
        } while (dirty && !stopped);
      } finally { running = false; }
    };
    const notify = (source: object) => { if (!stopped) { causes.add(source); void deliver(); } };
    const stop = () => { stopped = true; this.listeners.delete(notify); this.retirement.signal.removeEventListener("abort", stop); };
    this.retirement.signal.addEventListener("abort", stop, { once: true });
    this.listeners.add(notify); void deliver();
    return stop;
  }
  async backlog(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Sync storage requires desktop");
    const result = await this.adapter.backlog(signal);
    signal?.throwIfAborted();
    return { events: count(result.events), blobs: count(result.blobs) };
  }
  async account(signal?: AbortSignal): Promise<HostSyncAccount | null> {
    signal?.throwIfAborted();
    const before = this.adapter.status();
    if (!this.adapter.supported() || !before.accountConnected || before.backend !== "relay") return null;
    const epoch = this.guard(signal), account = await this.adapter.account();
    this.guard(signal, epoch);
    if (!account || typeof account !== "object" || Array.isArray(account)
      || !["free", "sync", "pro", "max", "staff"].includes(account.tier) || typeof account.hasBilling !== "boolean") throw new AppError("sync/server", "Invalid account response");
    return { tier: account.tier, hasBilling: account.hasBilling, blobBytesUsed: count(account.blobBytesUsed),
      eventsUsed: count(account.eventsUsed), aiCreditsUsed: count(account.aiCreditsUsed),
      limits: { maxBlobBytes: quota(account.limits?.maxBlobBytes), maxAccountBlobBytes: quota(account.limits?.maxAccountBlobBytes),
        maxAccountEvents: quota(account.limits?.maxAccountEvents), aiMonthlyCredits: quota(account.limits?.aiMonthlyCredits) } };
  }
  async requestSync(signal?: AbortSignal, origin: DomainActor = "user") {
    origin = causalActor(origin);
    const epoch = this.guard(signal);
    assertOperationConditions(await this.conditions(signal));
    this.guard(signal, epoch);
    const result = await this.adapter.run(origin);
    this.guard(signal, epoch);
    return { status: result === null ? "already-running" as const : "completed" as const, snapshot: await this.snapshot() };
  }
  async conditions(signal?: AbortSignal): Promise<OperationCondition[]> {
    signal?.throwIfAborted();
    const local = this.localConditions();
    if (local.some(value => value.state === "unavailable" || value.state === "unconfigured")) return local;
    const epoch = this.adapter.epoch();
    const provider = await this.adapter.conditions?.() ?? [{ kind: "provider" as const, state: "unknown" as const, reason: "sync-provider-not-checked" }];
    signal?.throwIfAborted();
    if (epoch !== this.adapter.epoch()) return [{ kind: "provider", state: "unknown", reason: "sync-connection-changed", errorCode: "ui/superseded" }];
    return [...this.localConditions(), ...provider];
  }
  private localConditions(): OperationCondition[] {
    const state = this.adapter.status();
    if (!this.adapter.supported()) return [{ kind: "provider", state: "unavailable", reason: "desktop-required", errorCode: "ui/unavailable" }];
    if (this.adapter.busy()) return [{ kind: "capacity", state: "unavailable", reason: "sync-connection-busy", errorCode: "ui/unavailable" }];
    if (!state.accountConnected) return [{ kind: "account", state: "unconfigured", reason: "sync-not-connected", errorCode: "ui/unavailable" }];
    if (state.state === "disabled") return [{ kind: "provider", state: "unconfigured", reason: "sync-disabled", errorCode: "ui/unavailable" }];
    if (state.state === "unauthenticated") return [{ kind: "account", state: "unconfigured", reason: "sync-reconnect-required", errorCode: "sync/unauthorized" }];
    return [{ kind: "account", state: "satisfied", reason: "sync-connected" }];
  }
  async openSettings(signal?: AbortSignal, origin: DomainActor = "user") {
    origin = causalActor(origin);
    signal?.throwIfAborted(); await this.adapter.openSettings(signal, origin); signal?.throwIfAborted();
    return { status: "opened" as const, surface: "dataSync" as const };
  }
  async connectionOptions() {
    if (!this.adapter.supported()) return [];
    return this.adapter.connectionOptions();
  }
  requestFlow(request: Parameters<HostSyncPort["requestFlow"]>[0], signal?: AbortSignal, origin: DomainActor = "user") {
    if (!this.adapter.supported()) return Promise.reject(new AppError("ui/unavailable", "Sync account flows require desktop"));
    return this.adapter.requestFlow(request, signal, causalActor(origin));
  }
  private guard(signal?: AbortSignal, expected?: string): string {
    signal?.throwIfAborted();
    if (expected !== undefined && expected !== this.adapter.epoch()) throw new AppError("ui/superseded", "Sync connection changed during the request");
    assertOperationConditions(this.localConditions());
    return this.adapter.epoch();
  }
}
