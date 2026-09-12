import { AppError, type ResourceRef } from "@read-aware/core";
import type { PluginView, PluginViewResult } from "./plugin-types";
import { pluginCallbackOwner } from "../runtime/plugin-callback-wire";
import type { ResourceOwner } from "../../../services/resource-owner";
import { createLogger } from "../../../platform/logger";
const log = createLogger("plugin-file-drop");

type Owner = { name: string; resources: ResourceOwner; signal: AbortSignal };
const owners = new WeakMap<AbortSignal, Owner>();
export function registerPluginFileDropOwner(signal: AbortSignal, name: string, resources: ResourceOwner): void {
  const entry = { name, resources, signal };
  owners.set(signal, entry);
  signal.addEventListener("abort", () => owners.delete(signal), { once: true });
}
export function pluginFileDropOwner(drop: NonNullable<PluginView["fileDrop"]>): Owner | undefined {
  const signal = pluginCallbackOwner(drop.onDrop);
  return signal ? owners.get(signal) : undefined;
}
function matches(drop: NonNullable<PluginView["fileDrop"]>, files: readonly { name: string }[]): boolean {
  return files.length > 0 && files.length <= (drop.multiple ? 16 : 1)
    && (!drop.extensions?.length || files.every(file => drop.extensions!.includes(file.name.includes(".") ? file.name.split(".").at(-1)!.toLowerCase() : "")));
}
/** Called only by the host target after the browser's trusted drop event. */
export async function deliverPluginFiles(drop: NonNullable<PluginView["fileDrop"]>, files: File[], signal: AbortSignal): Promise<PluginViewResult> {
  const owner = pluginFileDropOwner(drop);
  if (!owner || owner.signal.aborted) throw new AppError("plugin/unavailable", "File drop owner retired");
  signal.throwIfAborted();
  if (!matches(drop, files)) {
    throw new AppError("ui/invalid-target", "Dropped files do not match this target");
  }
  const refs = await owner.resources.importDroppedFiles(files, signal);
  return deliver(drop, refs, owner, signal);
}
export async function pickPluginFiles(drop: NonNullable<PluginView["fileDrop"]>, signal: AbortSignal): Promise<PluginViewResult> {
  const owner = pluginFileDropOwner(drop);
  if (!owner || owner.signal.aborted) throw new AppError("plugin/unavailable", "File drop owner retired");
  const result = await owner.resources.pick({ multiple: drop.multiple, extensions: drop.extensions }, signal);
  if (result.cancelled) return null;
  return deliver(drop, result.resources, owner, signal);
}
async function deliver(drop: NonNullable<PluginView["fileDrop"]>, refs: ResourceRef[], owner: Owner, signal: AbortSignal) {
  try {
    signal.throwIfAborted(); owner.signal.throwIfAborted();
    if (!matches(drop, refs)) throw new AppError("ui/invalid-target", "Selected files do not match this target");
    return await drop.onDrop(refs);
  }
  catch (error) {
    // No result has adopted the references. Revoke them even when a callback fails.
    for (const ref of refs) await owner.resources.release(ref.id).catch(error => { if (!owner.signal.aborted) log.warn("Dropped resource cleanup failed", error); });
    throw error;
  }
}
