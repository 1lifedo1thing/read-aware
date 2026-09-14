import { causalActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { AppError, type OperationCondition } from "@read-aware/core";

type Request = { action: string };
type Receipt<R extends Request, S extends string> = { action: R["action"]; status: S | "cancelled" };
type Surface<R extends Request> = { open(request: R, signal?: AbortSignal): void; close(): void };
type Pending<R extends Request, S extends string> = {
  origin: DomainActor; request: R; surface: Surface<R>; started: boolean; epoch: unknown;
  signal?: AbortSignal;
  resolve(receipt: Receipt<R, S>): void; reject(error: unknown): void;
  cleanup(): void;
};

/** Only the settings owner can perform/settle an action. Callers receive no
 * confirmation handles and cannot approve their own destructive requests. */
export class HostActionFlow<R extends Request, S extends string> {
  private surface?: Surface<R>;
  private pending?: Pending<R, S>;
  private requesting = false;
  private running = false;
  constructor(private config: {
    navigate(signal?: AbortSignal, origin?: DomainActor): Promise<unknown>;
    normalize(input: R): R;
    completion(action: R["action"], value: unknown): S | "cancelled";
    epoch?(): unknown;
  }) {}

  private get occupied(): boolean { return this.requesting || !!this.pending || this.running; }

  requestConditions(confirmationRequired = true): OperationCondition[] {
    if (this.occupied) return [{ kind: "capacity", state: "unavailable", reason: "host-flow-active", errorCode: "ui/unavailable" }];
    return [{ kind: "capacity", state: "satisfied", reason: "host-flow-ready" },
      { kind: "provider", state: "unknown", reason: "host-flow-controls-not-checked" },
      ...(confirmationRequired ? [{ kind: "input" as const, state: "unknown" as const, reason: "host-flow-user-confirmation-required" }] : [])];
  }

  bind(surface: Surface<R>): () => void {
    this.surface = surface;
    return () => {
      if (this.surface !== surface) return;
      this.surface = undefined;
      const pending = this.pending;
      // A confirmed native operation keeps ownership until its real settlement.
      if (pending?.surface === surface && !pending.started) this.settle(pending, "cancelled");
    };
  }

  async request(input: R, signal?: AbortSignal, origin: DomainActor = "user"): Promise<Receipt<R, S>> {
    signal?.throwIfAborted();
    origin = causalActor(origin);
    const request = stampEventCause(this.config.normalize(input), origin);
    if (this.occupied) throw new AppError("ui/unavailable", "A host action flow is already active");
    this.requesting = true;
    try {
      await this.config.navigate(signal, origin);
      signal?.throwIfAborted();
      if (this.running) throw new AppError("ui/unavailable", "A native action started during navigation");
      const surface = this.surface;
      if (!surface) throw new AppError("ui/unavailable", "Host action controls are not mounted");
      return await new Promise<Receipt<R, S>>((resolve, reject) => {
        const abort = () => {
          if (this.pending !== pending || pending.started) return;
          this.settle(pending, "cancelled");
          surface.close();
        };
        const pending: Pending<R, S> = { origin, request, surface, signal, started: false, epoch: this.config.epoch?.(), resolve, reject,
          cleanup: () => signal?.removeEventListener("abort", abort) };
        this.pending = pending;
        signal?.addEventListener("abort", abort, { once: true });
        try { surface.open(request, signal); }
        catch (error) { this.fail(pending, error); }
      });
    } finally { this.requesting = false; }
  }

  dismiss(action: R["action"], origin: DomainActor = "user"): void {
    const pending = this.pending;
    if (pending?.request.action === action && !pending.started) this.settle(pending, "cancelled", causalActor(origin));
  }

  /** Preparation failed before confirmation; no native effect was started. */
  reject(action: R["action"], error: unknown): void {
    const pending = this.pending;
    if (pending?.request.action === action && !pending.started) this.fail(pending, error);
  }

  /** Used by the existing native UI command callbacks, not exported to actors. */
  async run<T>(action: R["action"], operation: (signal?: AbortSignal, origin?: DomainActor) => Promise<T>, retryInDialog = false, origin: DomainActor = "user"): Promise<T> {
    if (this.running) throw new AppError("ui/unavailable", "Host action is already running");
    const pending = this.pending;
    if (pending && pending.request.action !== action) throw new AppError("ui/unavailable", "Another host dialog owns this request");
    pending?.signal?.throwIfAborted();
    if (pending && pending.epoch !== this.config.epoch?.()) {
      const error = new AppError("ui/superseded", "Host state changed before confirmation");
      this.fail(pending, error);
      throw error;
    }
    origin = causalActor(origin);
    if (pending) { pending.started = true; pending.origin = origin; }
    this.running = true;
    try {
      const result = await operation(pending?.signal, origin);
      if (pending) this.settle(pending, this.config.completion(action, result));
      return result;
    } catch (error) {
      if (pending) {
        pending.started = false;
        if (pending.signal?.aborted) this.settle(pending, "cancelled");
        else if (!retryInDialog || this.surface !== pending.surface) this.fail(pending, error);
      }
      throw error;
    } finally {
      this.running = false;
      if (pending?.signal?.aborted) pending.surface.close();
    }
  }

  private settle(pending: Pending<R, S>, status: S | "cancelled", origin: DomainActor = pending.origin): void {
    if (this.pending !== pending) return;
    this.pending = undefined; pending.cleanup();
    if (pending.signal?.aborted) pending.reject(pending.signal.reason);
    else pending.resolve(stampEventCause({ action: pending.request.action, status }, origin));
  }
  private fail(pending: Pending<R, S>, error: unknown): void {
    if (this.pending !== pending) return;
    this.pending = undefined; pending.cleanup(); pending.reject(error);
  }
}
