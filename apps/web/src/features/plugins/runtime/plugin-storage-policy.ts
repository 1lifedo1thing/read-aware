import { PLUGIN_ASSET_MAX_BYTES, PLUGIN_ASSET_TOTAL_BYTES, PLUGIN_ASSET_MAX_COUNT } from "@read-aware/core";
import type { PluginStoragePolicy, PluginStorageUsage } from "@read-aware/plugin-types";
import { invoke } from "../../../platform/ipc";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { DOCUMENT_BYTES, BATCH_BYTES } from "./plugin-documents";

export function createPluginStoragePolicy(pluginId: string, lifecycle: PluginLifecycleController,
  read = () => invoke<PluginStorageUsage>("plugin_storage_usage", { pluginId })) {
  return (): Promise<PluginStoragePolicy> => lifecycle.read("services.storage.policy", async () => ({
    usage: await read(),
    kv: { roaming: "preference-events", localOnlyKeys: ["schedule-state", "schedule-runs"], backup: "complete", uninstall: "retain", maxBytes: null },
    documents: { roaming: "none", backup: "complete", uninstall: "delete", maxBytes: null,
      putMaxDocumentBytes: null, applyMaxDocumentBytes: DOCUMENT_BYTES, applyMaxBatchBytes: BATCH_BYTES, applyMaxChanges: 100 },
    secrets: { roaming: "none", backup: "excluded", uninstall: "retain", maxBytes: null, usage: null },
    assets: { roaming: "none", backup: "complete", uninstall: "delete",
      maxBytes: PLUGIN_ASSET_TOTAL_BYTES, maxItems: PLUGIN_ASSET_MAX_COUNT, maxItemBytes: PLUGIN_ASSET_MAX_BYTES },
    syncStatus: "not-measured",
  }));
}
