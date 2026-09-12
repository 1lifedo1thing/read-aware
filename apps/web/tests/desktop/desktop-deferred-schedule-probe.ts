import { appDataDir } from "@tauri-apps/api/path";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { getDefaultStore } from "jotai";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { parseProbeToast } from "./probe-toast";

let sandbox: SandboxedPlugin | undefined;
const disposables: PluginDisposable[] = [];
const id = "deferred-desktop-probe";
export async function startDeferredProbe() {
  const profile = (await appDataDir()).replace(/\\/g, "/").replace(/\/$/, "");
  if (!["/com.readaware.app.capability-onboarding-20260911", "/com.readaware.app.capability-e2e"].some(id => profile.endsWith(id))) throw Error("Isolated data required");
  if (sandbox) throw Error("Probe already running");
  sandbox = await startPluginWorker({ id, name: "Deferred probe", version: "1.0.0", schemaVersion: 1,
    requires: { services: { schedules: "^2.0.0" } }, schedules: [{ id: "work", label: "Work", mode: "deferred" }] }, "0.5.4", disposables,
  { moduleUrl: new URL("./deferred-schedule-probe.ts", import.meta.url).href });
  sandbox.promote(); await sandbox.checkHealth(); return { active: true };
}
export async function runDeferredProbe(commandId: "enqueue" | "inspect") {
  if (!sandbox) throw Error("Start probe first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === commandId);
  if (!command) throw Error("Missing probe command");
  return parseProbeToast((await command.run())!.toast!);
}
export async function stopDeferredProbe() {
  try { await sandbox?.terminate(); }
  finally { sandbox = undefined; for (const item of disposables.splice(0).reverse()) item.dispose(); }
  return { stopped: true };
}
