import { Channel } from "@tauri-apps/api/core";
import { invoke } from "../../src/platform/ipc";
import { flushLocalKV, localKV } from "../../src/platform/local-store";
import { withPluginDataBackup } from "../../src/platform/plugin-data-access";
import { withSyncBackup } from "../../src/platform/sync/sync-scheduler";
import { withBackupCapture } from "../../src/features/settings/lib/backup-capture";
import { installPluginFiles, uninstallPlugin } from "../../src/features/plugins/runtime/plugin-host";
import { listPluginEntries } from "../../src/features/plugins/runtime/plugin-backend";
import type { BackupReviewPage } from "../../src/features/settings/lib/backup-review-types";
import { assertFull2BookAccessProfile } from "./desktop-book-access-fixture";

let fixture: { id: string; archive: string; password: string } | undefined;
const fence = <T>(run: () => Promise<T>) => withSyncBackup(() => withPluginDataBackup("export", () => withBackupCapture(run)));
const kvSnapshot = async () => Object.entries(await invoke<Record<string, string>>("load_kv_all")).sort(([a], [b]) => a.localeCompare(b));

/** Capture our own inert source candidate. Password never leaves module memory. */
export async function prepareFull2BackupGrantFixture() {
  await assertFull2BookAccessProfile();
  if (fixture) throw new Error("Fixture already prepared");
  const id = `full2-backup-grant-${crypto.randomUUID()}`;
  const archive = `/tmp/${id}.age`;
  const password = `Full2-${crypto.randomUUID()}`;
  const taskId = crypto.randomUUID();
  let installed = false;
  try {
    await installPluginFiles(id, [
      { path: "manifest.json", content: JSON.stringify({ id, name: "Full2 Backup Grant Probe", version: "1.0.0", schemaVersion: 1, minAppVersion: "0.3.0", main: "main.js", permissions: [], requires: {}, description: "Owned inert acceptance fixture", author: "ReadAware" }) },
      { path: "main.js", content: "export default { activate() {} };" },
    ], { mode: "current" });
    installed = true;
    await flushLocalKV();
    await fence(() => invoke("backup_export_capture", { taskId, progress: new Channel() }));
    await invoke("backup_export_write", { taskId, password, destination: archive });
    fixture = { id, archive, password };
  } finally {
    await invoke("backup_export_cancel", { taskId });
    if (installed) await uninstallPlugin(id);
    await localKV.removeItemAsync(`read-aware-plugin-host.schema.${id}`);
    await localKV.removeItemAsync(`read-aware-plugin.${id}.schedule-state`);
    await flushLocalKV();
  }
  return { id, archive, passwordInMemoryOnly: true };
}

/** Release the in-memory secret; the desktop driver removes only this archive. */
export function releaseFull2BackupGrantFixture() {
  const archive = fixture?.archive;
  fixture = undefined;
  return { archive };
}

/** Native retained-review cancellation; UI consent controls are a separate gate. */
export async function runFull2BackupGrantCancelProbe() {
  await assertFull2BookAccessProfile();
  if (!fixture) throw new Error("Prepare fixture first");
  const taskId = crypto.randomUUID();
  try {
    await invoke("backup_import_open", { taskId, source: fixture.archive, password: fixture.password, progress: new Channel() });
    await fence(() => invoke("backup_import_plan", { taskId, progress: new Channel() }));
    let after: string | null = null;
    let sourceFound = false;
    do {
      const page: BackupReviewPage = await invoke("backup_import_review", { taskId, query: { kind: "programs", limit: 100, after } });
      if (page.kind !== "programs") throw new Error("Unexpected review page");
      sourceFound ||= page.entries.some(program => program.id === fixture!.id && program.candidates.some(candidate => candidate.side === "source") && !program.candidates.some(candidate => candidate.side === "target"));
      after = page.nextAfter;
    } while (after !== null);
    if (!sourceFound) throw new Error("Source-only candidate missing");
    const beforeKV = await kvSnapshot();
    const beforePlugins = await listPluginEntries();
    await invoke("backup_import_cancel", { taskId });
    if (JSON.stringify(beforeKV) !== JSON.stringify(await kvSnapshot())) throw new Error("Cancel changed KV");
    if (JSON.stringify(beforePlugins) !== JSON.stringify(await listPluginEntries())) throw new Error("Cancel changed plugin files");
    return { sourceFound, cancelKVUnchanged: true, cancelPluginsUnchanged: true, boundary: "native plan cancellation; consent UI pending" };
  } finally {
    await invoke("backup_import_cancel", { taskId });
  }
}
