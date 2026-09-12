import { AppError, type PluginAssetWrite } from "@read-aware/core";
import type { PluginCallOptions, PluginContext } from "@read-aware/plugin-types";
import { invoke } from "../../../platform/ipc";
import { resourceName, type ResourceOwner, type NativeResource } from "../../../services/resource-owner";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { pluginOperationSignal } from "./plugin-call-options";

type Assets = PluginContext["services"]["resources"]["assets"];
const invalid = () => new AppError("plugin/invalid-argument", "Invalid private asset request");
function key(input: unknown): string {
  if (typeof input !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(input)) throw invalid();
  return input;
}
function revision(input: unknown): string {
  if (typeof input !== "string" || !/^[a-f0-9]{32}$/.test(input)) throw invalid();
  return input;
}
export function createPluginAssets(pluginId: string, lifecycle: PluginLifecycleController, resources: ResourceOwner): Assets {
  const signal = (options?: PluginCallOptions) => pluginOperationSignal(lifecycle.signal, options);
  const active = () => lifecycle.assertActive("services.resources.assets");
  return {
    policy: options => { active(); return lifecycle.read("resources.assets.policy", () => invoke("plugin_asset_policy", { pluginId }), signal(options)); },
    get: (input, options) => {
      active(); const callSignal = signal(options), id = key(input);
      return lifecycle.read("resources.assets.get", () => invoke("plugin_asset_get", { pluginId, key: id }), callSignal);
    },
    list: (query, options) => {
      active(); const callSignal = signal(options);
      if (query !== undefined && (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).some(k => !["after", "limit"].includes(k)))) throw invalid();
      const limit = query?.limit ?? 50, after = query?.after === undefined ? undefined : key(query.after);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid();
      return lifecycle.read("resources.assets.list", () => invoke("plugin_asset_list", { pluginId, limit, after }), callSignal);
    },
    store: (resourceId, input: PluginAssetWrite, options) => {
      active(); const callSignal = signal(options);
      if (!input || typeof input !== "object" || Object.keys(input).some(k => !["key", "expectedRevision", "name"].includes(k))) throw invalid();
      const id = key(input.key), expectedRevision = input.expectedRevision === null ? null : revision(input.expectedRevision);
      const filename = input.name === undefined ? undefined : resourceName(input.name);
      return lifecycle.storageWrite("resources.assets.store", () => resources.useForWrite(resourceId, async (resource, beforeWrite) => {
        beforeWrite();
        return invoke("resource_store_plugin_asset", { pluginId, key: id, expectedRevision,
          id: resource.id, name: filename ?? resource.name, mimeType: resource.mimeType });
      }, callSignal));
    },
    open: (input, expected, options) => {
      active(); const callSignal = signal(options), id = key(input), expectedRevision = revision(expected);
      return lifecycle.read("resources.assets.open", () => resources.importAsset(
        () => invoke<NativeResource>("resource_open_plugin_asset", { pluginId, key: id, expectedRevision }), callSignal), callSignal);
    },
    delete: (input, expected, options) => {
      active(); const callSignal = signal(options), id = key(input), expectedRevision = revision(expected);
      callSignal.throwIfAborted();
      return lifecycle.storageWrite("resources.assets.delete", async () => {
        callSignal.throwIfAborted();
        return invoke("plugin_asset_delete", { pluginId, key: id, expectedRevision });
      });
    },
  };
}
