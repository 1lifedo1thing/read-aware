import { Channel } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "../../src/platform/ipc";
import { withPluginDataBackup } from "../../src/platform/plugin-data-access";
import { withSyncBackup } from "../../src/platform/sync/sync-scheduler";
import { withBackupCapture } from "../../src/features/settings/lib/backup-capture";
import type { FullBackupCaptureReceipt, FullBackupProgress } from "../../src/features/settings/lib/full-backup-export-task";
import type { BackupSourceReceipt, BackupPlanReceipt, FullBackupImportProgress } from "../../src/features/settings/lib/full-backup-import-task";
import type { BackupReviewPage } from "../../src/features/settings/lib/backup-review-types";

/** Isolated native capture/decrypt/review acceptance. Does not apply a restore,
 * exercise a file picker, or expose the generated archive password. */
export async function backupPreflight() {
  const profile = (await appDataDir()).replace(/[/\\]$/, "");
  if (!/\/com\.readaware\.app\.(capability-e2e|validation-backup-e2e)$/.test(profile)) throw Error("Requires isolated acceptance profile");
  const taskId = crypto.randomUUID(), wrongId = crypto.randomUUID(), importId = crypto.randomUUID();
  const destination = `/tmp/readaware-validation-${taskId}.age`;
  let password = `Validation-${crypto.randomUUID()}`;
  const phases: string[] = [];
  const captureProgress = new Channel<FullBackupProgress>();
  captureProgress.onmessage = update => phases.push(`export:${update.phase}`);
  const importProgress = new Channel<FullBackupImportProgress>();
  importProgress.onmessage = update => phases.push(`import:${update}`);
  let wrongPasswordCode: string | undefined;
  try {
    const capture = await withSyncBackup(fetchBlob => withPluginDataBackup("export",
      () => withBackupCapture(() => invoke<FullBackupCaptureReceipt>("backup_export_capture", { taskId, progress: captureProgress })),
      undefined, async () => {
        for (const key of await invoke<string[]>("backup_export_sources")) {
          if ((await fetchBlob(key)).outcome !== "fetched") throw Error("Backup source unavailable");
        }
      }));
    if (capture.taskId !== taskId || capture.format !== 2) throw Error("Invalid capture receipt");
    await invoke("backup_export_write", { taskId, password, destination });
    await invoke("backup_export_cancel", { taskId });
    try {
      await invoke("backup_import_open", { taskId: wrongId, source: destination, password: "Intentionally-wrong-validation-password", progress: importProgress });
    } catch (error) {
      wrongPasswordCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : String(error);
    } finally { await invoke("backup_import_cancel", { taskId: wrongId }); }
    if (!wrongPasswordCode) throw Error("Wrong password unexpectedly accepted");
    const source = await invoke<BackupSourceReceipt>("backup_import_open", { taskId: importId, source: destination, password, progress: importProgress });
    const plan = await withSyncBackup(() => withPluginDataBackup("export", () => withBackupCapture(
      () => invoke<BackupPlanReceipt>("backup_import_plan", { taskId: importId, progress: importProgress }))));
    const files: BackupReviewPage[] = [];
    let after: string | null = null;
    do {
      const page: BackupReviewPage = await invoke<BackupReviewPage>("backup_import_review", { taskId: importId, query: { kind: "files", limit: 100, after } });
      if (page.kind !== "files") throw Error("Unexpected file review");
      files.push(page); after = page.nextAfter;
    } while (after !== null);
    return { destination, capture, wrongPasswordCode, source, plan, files, phases: [...new Set(phases)] };
  } finally {
    password = "";
    await Promise.all([invoke("backup_export_cancel", { taskId }), invoke("backup_import_cancel", { taskId: importId })]);
  }
}
