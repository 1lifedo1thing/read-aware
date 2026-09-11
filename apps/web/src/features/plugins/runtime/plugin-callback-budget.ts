import { AppError } from "@read-aware/core";
import type { PluginCallbackWire } from "./plugin-callback-wire";
import { PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";
import type { BudgetLease } from "./plugin-host-budget";

/** Host accounting follows decoded graph leases, not untrusted release messages. */
export class PluginCallbackBudget {
  private retained = 0;
  private closed = false;
  private readonly leases = new Set<BudgetLease>();
  constructor(private readonly reserve?: (count: number) => BudgetLease) {}
  get size() { return this.retained; }
  acquire(wire: PluginCallbackWire) {
    if (this.closed) throw new AppError("plugin/unavailable", "Plugin callback owner has stopped");
    const handles = new Set(wire.callbacks.map(entry => entry.handle));
    if (handles.size !== wire.callbacks.length) throw new AppError("plugin/invalid-input", "Duplicate plugin callback handles");
    if (this.retained + handles.size > PLUGIN_WIRE_LIMITS.retainedCallbacks) throw new AppError("plugin/busy", "Plugin callback capacity exceeded");
    const lease = handles.size ? this.reserve?.(handles.size) : undefined;
    if (lease) this.leases.add(lease);
    this.retained += handles.size;
    const release = (values: readonly string[]) => {
      for (const handle of values) if (handles.delete(handle) && !this.closed) { this.retained--; lease?.release(1); }
      if (!handles.size && lease) this.leases.delete(lease);
    };
    return { release, dispose: () => release([...handles]) };
  }
  close() {
    this.closed = true; this.retained = 0;
    for (const lease of this.leases) lease.release();
    this.leases.clear();
  }
}
