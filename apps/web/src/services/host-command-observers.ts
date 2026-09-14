import { copyEventCause, ObservationCauses, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { AppError, errorCode, type HostCommandObservation, type HostCommandSnapshot } from "@read-aware/core";

/** Bounded, serial observations of the authorized command projection, never a command execution queue. */
export class HostCommandObservers {
  private active = 0;
  constructor(private readonly report: (error: unknown) => void) {}

  observe(
    read: (signal: AbortSignal) => Promise<HostCommandSnapshot>,
    subscribe: (invalidate: (source?: object) => void) => () => void,
    handler: (state: HostCommandObservation) => unknown,
    origin?: DomainActor,
  ): () => void {
    if (this.active >= 64) throw new AppError("ui/observer-limit", "Too many command observers");
    this.active++;
    const controller = new AbortController(), causes = new ObservationCauses(origin);
    let retained: object | undefined;
    let dirty = false, running = false, revision = 0, previous: string | undefined;
    const run = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        while (dirty && !controller.signal.aborted) {
          dirty = false;
          let value: Omit<Extract<HostCommandObservation, { status: "ready" }>, "revision"> | Omit<Extract<HostCommandObservation, { status: "error" }>, "revision">;
          try { value = { status: "ready", snapshot: await read(controller.signal) }; }
          catch (error) { this.report(error); value = { status: "error", code: errorCode(error) ?? "ui/unavailable" }; }
          if (controller.signal.aborted) return;
          if (dirty) continue;
          const identity = JSON.stringify(value);
          const event = causes.take({ ...value, revision: revision + 1 }, retained);
          retained = value.status === "error" ? copyEventCause(event, {}) : undefined;
          if (identity === previous) continue;
          revision++;
          try { await handler(event); previous = identity; }
          catch (error) { retained = copyEventCause(event, {}); this.report(error); }
        }
      } finally { running = false; }
    };
    const invalidate = (source?: object) => { causes.add(source ?? stampEventCause({}, origin)); dirty = true; void run(); };
    let release: () => void;
    try { release = subscribe(invalidate); }
    catch (error) { controller.abort(); this.active--; throw error; }
    invalidate();
    return () => {
      if (controller.signal.aborted) return;
      controller.abort(); this.active--;
      release();
    };
  }
}
