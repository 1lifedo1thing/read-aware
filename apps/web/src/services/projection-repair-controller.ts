import { actorFromEvent, causalActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { AppError, type ProjectionVerification } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";

type State = null | { step: "checking" } | { step: "preview"; report: ProjectionVerification }
  | { step: "working" } | { step: "done" } | { step: "failed"; error: unknown };

/** Host-owned state survives settings unmounts while a confirmed native repair
 * finishes. Actors can request the flow, but cannot call confirm. */
export class ProjectionRepairController {
  private state: State = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private flow: HostActionFlow<{ action: "repair" }, "rebuilt-reload-required">,
    private verify: (signal?: AbortSignal, origin?: DomainActor) => Promise<ProjectionVerification>,
    private apply: (signal?: AbortSignal, origin?: DomainActor) => Promise<void>,
    private log: (error: unknown) => void) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: State, origin: DomainActor = "user") { this.state = state ? stampEventCause(state, origin) : null; for (const listener of this.listeners) listener(); }
  open = (_request: { action: "repair" }, signal?: AbortSignal) => {
    if (this.state) throw new AppError("ui/unavailable", "Projection repair controls are already active");
    signal?.throwIfAborted();
    const origin = actorFromEvent(_request);
    const ticket = ++this.generation;
    this.publish({ step: "checking" }, origin);
    void Promise.resolve().then(() => this.verify(signal, origin)).then(report => {
      if (ticket === this.generation && !signal?.aborted) this.publish({ step: "preview", report }, origin);
    }, error => {
      if (ticket !== this.generation) return;
      this.log(error); this.flow.reject("repair", error); this.publish({ step: "failed", error }, origin);
    });
  };
  close = () => {
    // Cancellation after confirmation cannot hide the repair/reload result.
    if (this.state?.step === "working" || this.state?.step === "done") return;
    this.generation++; this.flow.dismiss("repair"); this.publish(null);
  };
  confirm = async () => {
    if (this.state?.step !== "preview" || this.state.report.consistent) return;
    const origin = causalActor("user");
    this.publish({ step: "working" }, origin);
    try {
      await this.flow.run("repair", this.apply, false, origin);
      this.publish({ step: "done" }, origin);
    } catch (error) {
      this.log(error); this.publish({ step: "failed", error }, origin);
    }
  };
}
