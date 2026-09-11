import { invoke } from "../../../platform/ipc";
import { flushLocalKV, restoreLocalKVTransaction } from "../../../platform/local-store";
import type { PluginDocumentSnapshotRow } from "./plugin-backend";

export const PLUGIN_SCHEMA_KEY_PREFIX = "read-aware-plugin-host.schema.";
export type PluginDataSnapshot = {
  pluginId: string;
  kv: Record<string, string>;
  documents: PluginDocumentSnapshotRow[];
  schema: string | null;
};

export function pluginDataSchemaVersion(raw: string | null): number | null {
  if (raw == null || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function snapshotPluginData(id: string): Promise<PluginDataSnapshot> {
  await flushLocalKV(`read-aware-plugin.${id}.`);
  await flushLocalKV(PLUGIN_SCHEMA_KEY_PREFIX + id);
  return invoke("plugin_data_snapshot", { pluginId: id });
}

export function restorePluginData(id: string, snapshot: PluginDataSnapshot): Promise<void> {
  // Own the baseline before joining the write queue; no caller mutation can change it.
  const baseline = structuredClone(snapshot);
  return restoreLocalKVTransaction(
    `read-aware-plugin.${id}.`, baseline.kv,
    new Map([[PLUGIN_SCHEMA_KEY_PREFIX + id, baseline.schema]]),
    () => invoke("plugin_data_restore", { pluginId: id, snapshot: baseline }),
  );
}
