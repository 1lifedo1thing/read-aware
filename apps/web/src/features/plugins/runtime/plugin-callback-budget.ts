import { AppError } from "@read-aware/core";
import type { PluginCallbackWire } from "./plugin-callback-wire";
import { PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";

/** Host accounting follows decoded graph leases, not untrusted release messages. */
export class PluginCallbackBudget {
  private retained = 0;
  private closed = false;
  get size() { return this.retained; }
  acquire(wire: PluginCallbackWire) {
    if (this.closed) throw new AppError("plugin/unavailable", "Plugin callback owner has stopped");
    const handles = new Set(wire.callbacks.map(entry => entry.handle));
    if (handles.size !== wire.callbacks.length) throw new AppError("plugin/invalid-input", "Duplicate plugin callback handles");
    if (this.retained + handles.size > PLUGIN_WIRE_LIMITS.retainedCallbacks) throw new AppError("plugin/busy", "Plugin callback capacity exceeded");
    this.retained += handles.size;
    const release = (values: readonly string[]) => {
      for (const handle of values) if (handles.delete(handle) && !this.closed) this.retained--;
    };
    return { release, dispose: () => release([...handles]) };
  }
  close() { this.closed = true; this.retained = 0; }
}
