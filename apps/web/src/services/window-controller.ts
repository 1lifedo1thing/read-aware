import { AppError, errorCode, normalizeHostWindowRequest, type HostWindowObservation,
  type HostWindowPort, type HostWindowRequest, type HostWindowSnapshot, type HostWindowState } from "@read-aware/core";
import { causalActor, copyEventCause, stampEventCause, type DomainActor } from "../platform/domain-actor";

export type WindowViewport = { width: number; height: number };

export type WindowAdapter = {
  supported(): boolean;
  read(): Promise<HostWindowState & { viewport?: WindowViewport }>;
  apply(request: HostWindowRequest, signal?: AbortSignal): Promise<void>;
  watch(changed: () => void): Promise<() => void>;
};

/** Main-window intents only. A native acknowledgement is not an animation receipt. */
export class HostWindowService implements HostWindowPort {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private revision = 0;
  private previous = "";
  private observed?: HostWindowSnapshot;
  private viewport: WindowViewport | null = null;
  private commandRevision = 0;
  private layoutReading?: { revision: number; work: Promise<WindowViewport | null> };
  private reading?: Promise<HostWindowSnapshot>;
  private listeners = new Set<() => void>();
  private stopWatch?: () => void;
  private watchGeneration = 0;

  constructor(private adapter: WindowAdapter, private report: (error: unknown) => void) {}

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (this.queued >= 32) return Promise.reject(new AppError("ui/unavailable", "Too many pending window requests"));
    this.queued++;
    const result = this.tail.then(run).finally(() => { this.queued--; });
    this.tail = result.catch(() => {}); // Failure must not poison later independent intents.
    return result;
  }

  private async read(origin?: DomainActor): Promise<HostWindowSnapshot> {
    const native = this.adapter.supported() ? await this.adapter.read() : null;
    // Geometry is host-private. The public window contract exposes no sizes or
    // platform fields, and read receipts do not claim animation completion.
    const state = native ? { supported: true as const, minimized: native.minimized, maximized: native.maximized,
      fullscreen: native.fullscreen, focused: native.focused } : { supported: false as const };
    const viewport = native?.viewport;
    const source = causalActor(origin ?? "system");
    if (viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0) {
      if (viewport.width !== this.viewport?.width || viewport.height !== this.viewport?.height) {
        this.viewport = stampEventCause({ width: viewport.width, height: viewport.height }, source);
      }
    } else this.viewport = null;
    const key = JSON.stringify(state);
    if (key !== this.previous) {
      this.previous = key; this.revision++;
      this.observed = stampEventCause({ ...state, revision: this.revision }, source);
    }
    return copyEventCause(this.observed!, { ...this.observed! });
  }

  /** Exact observed client geometry, for delayed DOM resize feedback only.
   * Callers must compare it with their still-current viewport after awaiting. */
  async layout(signal?: AbortSignal): Promise<WindowViewport | null> {
    signal?.throwIfAborted();
    if (!this.layoutReading || this.layoutReading.revision !== this.commandRevision) {
      const read = { revision: this.commandRevision, work: this.enqueue(async () => {
        await this.read();
        return this.viewport ? copyEventCause(this.viewport, { ...this.viewport }) : null;
      }) };
      this.layoutReading = read;
      void read.work.finally(() => { if (this.layoutReading === read) this.layoutReading = undefined; }).catch(() => {});
    }
    const value = await this.layoutReading.work;
    signal?.throwIfAborted();
    return value ? copyEventCause(value, { ...value }) : null;
  }

  async snapshot(signal?: AbortSignal): Promise<HostWindowSnapshot> {
    signal?.throwIfAborted();
    if (!this.reading) {
      const read = this.enqueue(() => this.read());
      this.reading = read;
      void read.finally(() => { if (this.reading === read) this.reading = undefined; }).catch(() => {}); // Caller receives the read failure.
    }
    const value = await this.reading;
    signal?.throwIfAborted();
    return copyEventCause(value, { ...value });
  }

  control(input: HostWindowRequest, signal?: AbortSignal, origin: DomainActor = "system") {
    const request = normalizeHostWindowRequest(input);
    origin = causalActor(origin);
    signal?.throwIfAborted();
    this.commandRevision++;
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Window controls require the desktop app");
      // Establish an unclaimed baseline before dispatch. A no-op request must
      // not relabel old state or geometry as an effect of the caller.
      await this.read();
      signal?.throwIfAborted();
      try {
        try { await this.adapter.apply(request, signal); }
        catch (error) {
          // Restore can fail after an earlier native step succeeded. Preserve
          // that observed effect even though the caller receives a failure.
          try { await this.read(origin); } catch (readError) { this.report(readError); }
          throw error;
        }
        const snapshot = await this.read(origin);
        signal?.throwIfAborted();
        return { status: "requested" as const, snapshot };
      } finally { this.notify(); }
    });
  }

  private notify = () => { for (const listener of this.listeners) listener(); };

  observe(handler: (value: HostWindowObservation) => unknown): () => void {
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected window observer");
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many window observers");
    let stopped = false, running = false, dirty = false, last = "";
    const deliver = async () => {
      dirty = true;
      if (running || stopped) return;
      running = true;
      try {
        do {
          dirty = false;
          let value: HostWindowObservation;
          try { const snapshot = await this.snapshot(); value = copyEventCause(snapshot, { status: "ready", snapshot }); }
          catch (error) { this.report(error); value = { status: "error", code: errorCode(error) ?? "ipc/unknown" }; }
          const key = JSON.stringify(value);
          if (!stopped && key !== last) {
            last = key;
            try { await handler(value); } catch (error) { this.report(error); }
          }
        } while (dirty && !stopped);
      } finally { running = false; }
    };
    const notify = () => { void deliver(); };
    this.listeners.add(notify);
    if (this.listeners.size === 1 && this.adapter.supported()) {
      const generation = ++this.watchGeneration;
      void this.adapter.watch(this.notify).then(stop => {
        if (generation !== this.watchGeneration || !this.listeners.size) stop();
        else { this.stopWatch = stop; this.notify(); }
      }).catch(error => this.report(error));
    }
    notify();
    return () => {
      if (stopped) return;
      stopped = true; this.listeners.delete(notify);
      if (!this.listeners.size) { this.watchGeneration++; this.stopWatch?.(); this.stopWatch = undefined; }
    };
  }
}
