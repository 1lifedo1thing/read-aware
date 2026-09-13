import { AppError, type ReadingControlsSnapshot } from "@read-aware/core";
import { causalActor, copyEventCause, stampEventCause, type DomainActor } from "../../../platform/domain-actor";

type RenderState = { visible: boolean; revision: number; origin: DomainActor };
type Pending = { state: RenderState; resolve(value: ReadingControlsSnapshot): void; reject(error: unknown): void; cleanup(): void };

/** Requested state drives React; only a committed render acknowledges a command. */
export class ReadingControlsController {
  private rendered: ReadingControlsSnapshot = stampEventCause({ visible: false });
  private desired: RenderState = { visible: false, revision: 0, origin: causalActor("system") };
  private pending: Pending | undefined;
  private readonly renderListeners = new Set<() => void>();
  private readonly observers = new Set<(origin?: DomainActor) => void>();

  constructor(private readonly report: (error: unknown) => void, private readonly deadlineMs = 10_000) {}

  getRenderState = (): RenderState => this.desired;
  subscribeRender = (listener: () => void): (() => void) => {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  };
  snapshot(): ReadingControlsSnapshot { return copyEventCause(this.rendered, { ...this.rendered }); }
  observe(listener: (origin?: DomainActor) => void): () => void {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }

  setFromUI = (visible: boolean | ((current: boolean) => boolean), origin: DomainActor = "user"): void => {
    origin = causalActor(origin);
    this.cancel(new AppError("reader/superseded", "A newer reader controls intent replaced this command"));
    this.render(typeof visible === "function" ? visible(this.desired.visible) : visible, origin);
  };

  setVisible(visible: boolean, signal?: AbortSignal, origin: DomainActor = "system"): Promise<ReadingControlsSnapshot> {
    if (typeof visible !== "boolean") return Promise.reject(new AppError("reader/invalid-target", "Controls visibility must be boolean"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    origin = causalActor(origin);
    this.cancel(new AppError("reader/superseded", "A newer reader controls intent replaced this command"));
    return new Promise((resolve, reject) => {
      const state = { visible, revision: this.desired.revision + 1, origin };
      const abort = () => {
        if (this.pending?.state !== state) return;
        this.cancel(signal?.reason ?? new AppError("reader/timeout", "Reader controls did not render"));
        this.render(this.rendered.visible, origin);
      };
      const timer = setTimeout(abort, this.deadlineMs);
      this.pending = { state, resolve, reject, cleanup: () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
      } };
      signal?.addEventListener("abort", abort, { once: true });
      this.desired = state;
      this.notify(this.renderListeners);
    });
  }

  acknowledge(state: RenderState): void {
    if (state !== this.desired) return;
    const changed = state.visible !== this.rendered.visible;
    const rendered = stampEventCause({ visible: state.visible }, state.origin);
    this.rendered = rendered;
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup();
    const committed = this.snapshot();
    if (changed) this.notify(this.observers, state.origin, () => this.rendered === rendered);
    pending?.resolve(committed);
  }

  retire(): void {
    this.cancel(new AppError("reader/superseded", "Reader controls session ended"));
    const origin = causalActor("system");
    this.rendered = stampEventCause({ visible: false }, origin);
    this.render(false, origin);
  }

  private cancel(error: unknown): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup(); pending?.reject(error);
  }
  private render(visible: boolean, origin: DomainActor): void {
    this.desired = { visible, revision: this.desired.revision + 1, origin };
    this.notify(this.renderListeners);
  }
  private notify(listeners: Set<(origin?: DomainActor) => void>, origin?: DomainActor, current: () => boolean = () => true): void {
    for (const listener of [...listeners]) {
      if (!current()) break;
      try { listener(origin); } catch (error) { this.report(error); }
    }
  }
}
