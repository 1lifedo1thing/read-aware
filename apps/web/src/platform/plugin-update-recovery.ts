import { invoke } from "./ipc";
import { isTauri } from "./environment";
import { PluginPreferencePublication } from "./plugin-preference-publication";
import { createLogger } from "./logger";
const log = createLogger("plugin-update-recovery");

/** Must finish before local KV hydration, preference overlays or plugin code.
 * Native setup already performed recovery before any IPC was admitted.
 * Failed owners stay quarantined while unrelated app data remains available. */
export async function recoverPluginUpdates(): Promise<void> {
  if (!isTauri()) return;
  const failures = await invoke<{ pluginId: string; code: string }[]>("plugins_recovery_status");
  for (const failure of failures) {
    PluginPreferencePublication.quarantineOwner(failure.pluginId);
    log.warn("Plugin remains unavailable after native recovery", failure);
  }
}
