import { causalActor, stampEventCause, actorFromEvent, type DomainActor } from "../platform/domain-actor";
import { AppError, type ReaderPanel, type ReaderPanelReceipt, type ReaderPanelsSnapshot, type ReaderPanelsView, type ReadingSessionGuard } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import { createLogger } from "../platform/logger";
import { assertReaderPanelWidth, type ResizableReaderPanel } from "@read-aware/core";

type Adapter = {
  apply(panel: ReaderPanel, open: boolean, signal: AbortSignal, origin: DomainActor): Promise<void>;
  applyWidth(panel: ResizableReaderPanel, width: number, signal: AbortSignal, origin: DomainActor): Promise<void>;
  requestCommit(token: number, origin: DomainActor): void;
};
type Binding = { sessionId: string; bookId: string; adapter: Adapter; view: ReaderPanelsView; release(): void };
type Operation = { panel: ReaderPanel; open: boolean; width?: never } | { panel: ResizableReaderPanel; width: number; open?: never };
type Pending = Operation & {
  binding: Binding; token: number; ready: boolean; origin: DomainActor;
  controller: AbortController; resolve(receipt: ReaderPanelReceipt): void; reject(error: unknown): void; cleanup(): void;
};
const panels: readonly ReaderPanel[] = ["toc", "annotations", "appearance", "chat"];

/** S3 presentation service. The reading domain retains session and chrome ownership. */
export class ReaderPanelsService {
  private binding?: Binding;
  private pending?: Pending;
  private revision = 0;
  private origin: DomainActor = causalActor("system");
  private token = 0;
  private observers = new Set<(state: ReaderPanelsSnapshot | null) => unknown>();

  constructor(private readonly reading: Pick<ReadingSessionController, "snapshot" | "observe" | "setControls">,
    private readonly report: (error: unknown) => void, private readonly deadlineMs = 10_000) {}

  snapshot(): ReaderPanelsSnapshot | null {
    const binding = this.binding;
    const current = this.reading.snapshot();
    if (!binding || current.status !== "ready" || current.sessionId !== binding.sessionId) return null;
    return stampEventCause({ ...structuredClone(binding.view), sessionId: binding.sessionId, bookId: binding.bookId, revision: this.revision }, this.origin);
  }

  observe(handler: (state: ReaderPanelsSnapshot | null) => unknown): () => void {
    this.observers.add(handler); this.deliver(handler);
    return () => this.observers.delete(handler);
  }

  bind(sessionId: string, bookId: string, adapter: Adapter, initial: ReaderPanelsView, origin: DomainActor = "system"): { publish(view: ReaderPanelsView, token: number, origin?: DomainActor): void; dispose(origin?: DomainActor): void } {
    this.checkGuard({ sessionId, bookId });
    this.binding?.release();
    const binding: Binding = { sessionId, bookId, adapter, view: structuredClone(initial), release: () => {} };
    this.binding = binding;
    const dispose = (origin: DomainActor = "system") => {
      if (this.binding !== binding) return;
      this.binding = undefined;
      this.cancel(new AppError("reader/superseded", "Reader panels session ended"));
      unobserve(); this.changed(origin);
    };
    // Observe can deliver synchronously; the initial guard already proved identity.
    const unobserve = this.reading.observe(state => {
      if (state.sessionId !== sessionId || state.status !== "ready") dispose(actorFromEvent(state));
    });
    binding.release = dispose;
    this.changed(origin);
    return { dispose, publish: (view, token, origin = "system") => {
      if (this.binding !== binding) return;
      const hidden = binding.view.controlsVisible && !view.controlsVisible;
      const changed = JSON.stringify(binding.view) !== JSON.stringify(view);
      binding.view = structuredClone(view);
      if (hidden) this.cancel(new AppError("reader/superseded", "Reader controls were hidden"));
      const pending = this.pending;
      let receipt: ReaderPanelReceipt | undefined;
      if (pending?.binding === binding && pending.ready && pending.token === token) {
        const state = view.panels[pending.panel];
        if (pending.width !== undefined ? view.sizes[pending.panel as ResizableReaderPanel] === pending.width
          : state.open === pending.open && (!pending.open || state.visible)) {
          this.pending = undefined; pending.cleanup();
          // Capture this commit before an observer can start another operation.
          receipt = { status: "completed", panel: pending.panel, snapshot: stampEventCause({
            ...structuredClone(view), sessionId, bookId, revision: this.revision + (changed ? 1 : 0),
          }, pending.origin) };
        } else this.cancel(new AppError("reader/superseded", "Reader panel state changed before completion"));
      }
      if (changed) this.changed(origin);
      if (receipt) pending!.resolve(receipt);
    } };
  }

  setPanel(panel: ReaderPanel, open: boolean, signal?: AbortSignal, guard?: ReadingSessionGuard, origin: DomainActor = "user"): Promise<ReaderPanelReceipt> {
    if (!panels.includes(panel) || typeof open !== "boolean") return Promise.reject(new AppError("reader/invalid-target", "Invalid reader panel operation"));
    return this.dispatch({ panel, open }, signal, guard, origin);
  }

  setWidth(panel: ResizableReaderPanel, width: number, signal?: AbortSignal, guard?: ReadingSessionGuard, origin: DomainActor = "user"): Promise<ReaderPanelReceipt> {
    try { assertReaderPanelWidth(panel, width); } catch (error) { return Promise.reject(error); }
    return this.dispatch({ panel, width }, signal, guard, origin);
  }

  private dispatch(operation: Operation, signal?: AbortSignal, guard?: ReadingSessionGuard, origin: DomainActor = "user"): Promise<ReaderPanelReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    try { this.checkGuard(guard); } catch (error) { return Promise.reject(error); }
    const binding = this.binding;
    if (!binding || !this.snapshot()) return Promise.reject(new AppError("reader/unavailable", "Reader panels are not attached"));
    origin = causalActor(origin);
    this.cancel(new AppError("reader/superseded", "A newer panel intent replaced this request"));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => {
        if (this.pending?.controller === controller) this.cancel(signal?.reason ?? new AppError("reader/timeout", "Reader panel did not commit"));
      };
      const timer = setTimeout(abort, this.deadlineMs);
      const pending: Pending = { ...operation, binding, controller, origin, token: ++this.token, ready: false, resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      this.pending = pending;
      signal?.addEventListener("abort", abort, { once: true });
      void (async () => {
        if (operation.open) await this.reading.setControls(true, controller.signal, { sessionId: binding.sessionId, bookId: binding.bookId }, origin);
        controller.signal.throwIfAborted();
        if (operation.width !== undefined) await binding.adapter.applyWidth(operation.panel, operation.width, controller.signal, origin);
        else await binding.adapter.apply(operation.panel, operation.open, controller.signal, origin);
        controller.signal.throwIfAborted();
        if (this.pending !== pending || this.binding !== binding) return;
        pending.ready = true;
        binding.adapter.requestCommit(pending.token, origin);
      })().catch(error => { if (this.pending === pending) this.cancel(error); });
    });
  }

  private checkGuard(guard?: ReadingSessionGuard): void {
    const current = this.reading.snapshot();
    if (guard !== undefined && (!guard || typeof guard !== "object"
      || guard.sessionId !== undefined && typeof guard.sessionId !== "string"
      || guard.bookId !== undefined && typeof guard.bookId !== "string")) throw new AppError("reader/invalid-target", "Invalid session guard");
    if (guard?.sessionId !== undefined && guard.sessionId !== current.sessionId
      || guard?.bookId !== undefined && guard.bookId !== current.bookId) throw new AppError("reader/superseded", "Reader panels target changed");
    if (!current.sessionId || current.status !== "ready") throw new AppError("reader/unavailable", "Reader panels require a ready reader");
  }
  private cancel(error: unknown): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.cleanup(); pending.controller.abort(error); pending.reject(error); }
  }
  private changed(origin: DomainActor): void {
    this.origin = causalActor(origin);
    const revision = ++this.revision;
    for (const handler of [...this.observers]) {
      if (revision !== this.revision) break;
      this.deliver(handler);
    }
  }
  private deliver(handler: (state: ReaderPanelsSnapshot | null) => unknown): void {
    try { Promise.resolve(handler(this.snapshot())).catch(this.report); } catch (error) { this.report(error); }
  }
}

const log = createLogger("reader-panels");
export const readerPanels = new ReaderPanelsService(readingRuntime, error => log.warn("Panel observer failed", error));
