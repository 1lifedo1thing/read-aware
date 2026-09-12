import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { errorCode } from "@read-aware/core";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginHostBudget } from "../../src/features/plugins/runtime/plugin-host-budget";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";

const instances: { runtime: SandboxedPlugin; owned: PluginDisposable[] }[] = [];
const errors: string[] = [];
let outcome: unknown = null;
export async function startTrafficProbe() {
  const profile = (await appDataDir()).replace(/\\/g, "/").replace(/\/$/, "");
  if (!["/com.readaware.app.capability-onboarding-20260911", "/com.readaware.app.capability-e2e"].some(id => profile.endsWith(id))) throw Error("Isolated data required");
  if (instances.length) throw Error("Probe already running");
  errors.length = 0; outcome = null;
  for (const suffix of ["offender", "peer"]) {
    const owned: PluginDisposable[] = [];
    const runtime = await startPluginWorker({ id: `traffic-probe-${suffix}`, name: "Traffic probe", version: "1.0.0", schemaVersion: 1, requires: {} }, "0.5.4", owned,
      { moduleUrl: new URL("./traffic-budget-probe.ts", import.meta.url).href, onRuntimeError: message => { errors.push(message); } });
    instances.push({ runtime, owned }); runtime.promote(); await runtime.checkHealth();
  }
  return pluginHostBudget.snapshot();
}
export function floodTrafficProbe() {
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "traffic-probe-offender" && item.id === "flood");
  if (!command) throw Error("Start probe first");
  void Promise.resolve(command.run()).then(value => { outcome = { completed: value }; }, error => { outcome = { code: errorCode(error) }; });
  return { triggered: true };
}
export async function inspectTrafficProbe() {
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "traffic-probe-peer" && item.id === "ping");
  return { outcome, errors: [...errors], budget: pluginHostBudget.snapshot(), peer: command ? await command.run() : null,
    contributions: getDefaultStore().get(pluginCommandsAtom).filter(item => item.pluginId.startsWith("traffic-probe-")).map(item => `${item.pluginId}:${item.id}`) };
}
export async function stopTrafficProbe() {
  for (const { runtime, owned } of instances.splice(0).reverse()) {
    try { await runtime.terminate(); }
    finally { for (const item of owned.reverse()) item.dispose(); }
  }
  return pluginHostBudget.snapshot();
}
