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
    private verify: (signal?: AbortSignal) => Promise<ProjectionVerification>,
    private apply: (signal?: AbortSignal) => Promise<void>,
    private log: (error: unknown) => void) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: State) { this.state = state; for (const listener of this.listeners) listener(); }
  open = (_request: { action: "repair" }, signal?: AbortSignal) => {
    if (this.state) throw new AppError("ui/unavailable", "Projection repair controls are already active");
    signal?.throwIfAborted();
    const ticket = ++this.generation;
    this.publish({ step: "checking" });
    void Promise.resolve().then(() => this.verify(signal)).then(report => {
      if (ticket === this.generation && !signal?.aborted) this.publish({ step: "preview", report });
    }, error => {
      if (ticket !== this.generation) return;
      this.log(error); this.flow.reject("repair", error); this.publish({ step: "failed", error });
    });
  };
  close = () => {
    // Cancellation after confirmation cannot hide the repair/reload result.
    if (this.state?.step === "working" || this.state?.step === "done") return;
    this.generation++; this.flow.dismiss("repair"); this.publish(null);
  };
  confirm = async () => {
    if (this.state?.step !== "preview" || this.state.report.consistent) return;
    this.publish({ step: "working" });
    try {
      await this.flow.run("repair", this.apply);
      this.publish({ step: "done" });
    } catch (error) {
      this.log(error); this.publish({ step: "failed", error });
    }
  };
}
