import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";

export async function runNetworkRetryProbe() {
  if (!(await appDataDir()).replace(/\\/g, "/").replace(/\/$/, "").endsWith("/com.readaware.app.capability-onboarding-20260911")) throw Error("Isolated data required");
  const owned: PluginDisposable[] = [];
  const runtime = await startPluginWorker({ id: "network-retry-probe", name: "Network retry probe", version: "1.0.0", schemaVersion: 1,
    description: "http://127.0.0.1:5188/retry", permissions: ["service:network"], networkAccess: { origins: ["http://127.0.0.1:5188"] },
    requires: { services: { network: "^2.2.0" } } }, "0.5.4", owned,
    { moduleUrl: new URL("./network-retry-probe.ts", import.meta.url).href });
  try {
    runtime.promote(); await runtime.checkHealth();
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "network-retry-probe" && item.id === "retry");
    if (!command) throw Error("Missing retry command");
    return await command.run();
  } finally {
    try { await runtime.terminate(); }
    finally { for (const item of owned.reverse()) item.dispose(); }
  }
}
