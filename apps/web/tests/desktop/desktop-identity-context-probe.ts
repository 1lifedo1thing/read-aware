import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { parseProbeToast } from "./probe-toast";

const workers: SandboxedPlugin[] = [], disposables: PluginDisposable[] = [];
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.validation-backup-e2e")) {
    throw Error("Requires the disposable validation-backup-e2e profile");
  }
}
export async function prepareIdentityContextProbe() {
  await isolated(); if (workers.length) throw Error("Retire previous actors first");
  for (const role of ["empty", "read", "write"] as const) {
    const worker = await startPluginWorker({ id: `capability-identity-${role}`, name: `Identity ${role}`, version: "1.0.0", schemaVersion: 1,
      permissions: role === "empty" ? [] : [role === "read" ? "memory:read" : "memory:write"],
      requires: { domains: { memory: "^2.5.0" }, services: { resources: "^1.0.0" } } }, "0.5.4", disposables,
      { moduleUrl: new URL("./identity-context-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  return { actors: workers.length };
}
export async function identityContextCommand(role: "empty" | "read" | "write", action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === `capability-identity-${role}` && item.id === action);
  if (!command) throw Error("Identity command unavailable");
  return parseProbeToast((await command.run())!.toast!);
}
export async function retireIdentityContextProbe() {
  await isolated();
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const item of disposables.splice(0).reverse()) item.dispose();
  return { contributions: ["empty", "read", "write"].reduce((n, role) => n + inspectContributions(`capability-identity-${role}`).length, 0) };
}
