import { AppError } from "@read-aware/core";
import type { PluginDataSnapshot } from "../../plugins/runtime/plugin-data-snapshot";
import type { BackupProgramChoice, BackupProgramRef } from "../../plugins/runtime/backup-program-review";
import { createBackupProgramStorage } from "../../plugins/runtime/backup-program-storage";
import { planPluginDataMigration } from "../../plugins/runtime/plugin-data-migration";
import { pluginCandidateModuleUrl } from "../../plugins/runtime/plugin-backend";
import { startPluginWorker } from "../../plugins/runtime/plugin-worker-host";
import { reviewFullBackupPrograms } from "./full-backup-program-review";
import type { FullBackupReview } from "./full-backup-import-task";

export type BackupProgramResult = {
  program: BackupProgramRef; consented: boolean; hasMigration: boolean; migrated?: PluginDataSnapshot;
};

/** Consent is obtained by the desktop review before any source module loads.
 * No candidate is promoted, installed, or given the live storage namespace. */
export async function migrateFullBackupPrograms(
  review: FullBackupReview, choices: ReadonlyMap<string, BackupProgramChoice>,
  consented: ReadonlySet<string>, appVersion: string, signal?: AbortSignal,
): Promise<Record<string, BackupProgramResult>> {
  const selected = new Map([...choices].map(([id, choice]) => [id, structuredClone(choice)]));
  const approvals = new Set(consented);
  const programs = await reviewFullBackupPrograms(review, selected, appVersion, signal);
  const results: Record<string, BackupProgramResult> = {};
  for (const program of programs) {
    signal?.throwIfAborted();
    if (!program.manifest || !program.choice.program) continue;
    if (program.consentRequired && !approvals.has(program.id)) throw new AppError("backup/incomplete", "Source program consent is required");
    const stage = await review.stageProgram({ id: program.id, choices: Object.fromEntries(selected), consented: approvals.has(program.id) });
    signal?.throwIfAborted();
    const storage = createBackupProgramStorage(program.id, stage.storage, query => review.stageStorage(stage.token, query));
    let runtimeError: string | undefined;
    const worker = await startPluginWorker(program.manifest, appVersion, [], {
      moduleUrl: pluginCandidateModuleUrl(stage.token, program.manifest.main ?? "main.js"),
      instanceId: `restore:${stage.token}`, restoreStorage: storage,
      onRuntimeError: error => { runtimeError = error; },
    });
    let termination: Promise<void> | undefined;
    const stop = () => termination ??= worker.terminate();
    const abort = () => { void stop().catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    let migration: ReturnType<typeof planPluginDataMigration>;
    try {
      signal?.throwIfAborted();
      migration = planPluginDataMigration({ storedVersion: program.data.schema, targetVersion: program.manifest.schemaVersion, hasMigration: worker.hasMigration });
      if (migration) await worker.migrate(migration);
      await worker.checkHealth();
      if (runtimeError) throw new AppError("backup/incomplete", "Restore plugin failed", { cause: runtimeError });
    } finally {
      signal?.removeEventListener("abort", abort);
      await stop();
    }
    signal?.throwIfAborted();
    results[program.id] = {
      program: program.choice.program, consented: approvals.has(program.id), hasMigration: worker.hasMigration,
      ...(migration ? { migrated: await review.stageStorage<PluginDataSnapshot>(stage.token, { kind: "snapshot", schemaVersion: program.manifest.schemaVersion }) } : {}),
    };
  }
  return results;
}
