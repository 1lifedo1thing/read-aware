import { AppError } from "@read-aware/core";
import { reviewBackupPrograms, type BackupProgramChoice, type BackupProgramFacts } from "../../plugins/runtime/backup-program-review";
import type { FullBackupReview } from "./full-backup-import-task";

/** Feed the complete captured catalog into the existing manifest, permission
 * and schema gate. Its output is still an obligation to obtain consent/probe
 * migrations, never installation authority or an applied restore. */
export async function reviewFullBackupPrograms(review: Pick<FullBackupReview, "read" | "disposed">, choices: ReadonlyMap<string, BackupProgramChoice>, appVersion: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (review.disposed) throw new AppError("backup/changed", "Backup review has been disposed");
  const selected = new Map([...choices].map(([id, choice]) => [id, structuredClone(choice)]));
  const facts: BackupProgramFacts[] = [];
  let after: string | null = null;
  do {
    signal?.throwIfAborted();
    const page = await review.read({ kind: "programs", after, limit: 100 }, signal);
    if (page.kind !== "programs" || facts.length + page.entries.length > 10_000
      || page.nextAfter !== null && (page.entries.length === 0 || page.nextAfter !== page.entries.at(-1)?.id || after !== null && page.nextAfter <= after)) {
      throw new AppError("backup/changed", "Incomplete plugin review catalog");
    }
    facts.push(...page.entries); after = page.nextAfter;
  } while (after !== null);
  signal?.throwIfAborted();
  if (review.disposed) throw new AppError("backup/changed", "Backup review has been disposed");
  return reviewBackupPrograms(facts, selected, appVersion);
}
