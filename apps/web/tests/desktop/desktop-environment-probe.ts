import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { buildEnvironmentTools } from "../../../../packages/agent/src/tools/environment-tools";

const id = "capability-environment-probe";
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareEnvironmentProbe() {
  const path = await isolated();
  if (worker) throw Error("Probe already active");
  try {
    worker = await startPluginWorker({ id, name: "Environment diagnostic", version: "1.0.0", schemaVersion: 1, permissions: [],
      requires: { services: { session: "^2.0.0" }, contributions: { commands: "^1.0.0" } } }, "0.5.4", disposables,
      { moduleUrl: new URL("./environment-probe.ts", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    return { path };
  } catch (error) { await cleanupEnvironmentProbe(); throw error; }
}
export async function pluginEnvironment(action: "read" | "dispose" = "read") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === action);
  if (!command) throw Error("Environment command unavailable");
  const result = await command.run();
  if (!result?.toast) throw Error("Environment receipt missing");
  return parseProbeToast(result.toast) as unknown;
}
export async function agentEnvironment() {
  await isolated();
  return buildEnvironmentTools(buildRuntimeDeps())[0]!.execute("environment-e2e", {});
}
export async function cleanupEnvironmentProbe() {
  await isolated(); await worker?.terminate(); worker = undefined;
  for (const disposable of disposables.reverse()) disposable.dispose(); disposables = [];
  return { commands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === id).length };
}
