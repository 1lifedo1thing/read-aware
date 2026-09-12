import { AppError } from "@read-aware/core";
import type { BackupProgramChoice, BackupProgramFacts, BackupSide } from "../../plugins/runtime/backup-program-review";
import type { BackupCredentialChoice } from "./full-backup-apply";
import type { FullBackupReview } from "./full-backup-import-task";
import type { BackupCredentialFacts, BackupReviewCell, BackupReviewPage } from "./backup-review-types";

export type BackupFileFact = Extract<BackupReviewPage, { kind: "files" }>["entries"][number];
export type BackupRowsPage = Extract<BackupReviewPage, { kind: "rows" }>;
export type BackupFieldsPage = Extract<BackupReviewPage, { kind: "rowFields" }>;
export type BackupDecisions = Extract<BackupReviewPage, { kind: "rowDecisions" }>;
export type BackupReviewModel = {
  files: BackupFileFact[]; programs: BackupProgramFacts[]; credentials: BackupCredentialFacts[];
  fileChoices: Record<string, BackupSide>; programChoices: Record<string, BackupProgramChoice>;
  credentialChoices: Record<string, BackupCredentialChoice>;
  decisions: BackupDecisions;
};
export async function readBackupDecisions(review: FullBackupReview): Promise<BackupDecisions> {
  const page = await review.read({ kind: "rowDecisions" });
  if (page.kind !== "rowDecisions") throw new AppError("backup/changed", "Unexpected row decisions");
  return page;
}
export async function loadBackupReviewModel(review: FullBackupReview): Promise<BackupReviewModel> {
  const model: BackupReviewModel = { files: [], programs: [], credentials: [], fileChoices: {}, programChoices: {}, credentialChoices: {}, decisions: await readBackupDecisions(review) };
  for (const kind of ["files", "programs", "credentials"] as const) {
    let after: string | null = null;
    do {
      const page = await review.read({ kind, after, limit: 100 });
      if (page.kind === "files") model.files.push(...page.entries.filter(file => file.policy === "blob" && file.source !== null && file.kind !== "same"));
      else if (page.kind === "programs") model.programs.push(...page.entries);
      else if (page.kind === "credentials") model.credentials.push(...page.entries);
      else throw new AppError("backup/changed", "Unexpected backup catalog");
      after = page.nextAfter;
    } while (after !== null);
  }
  return model;
}
/** Explicit bulk action only. It does not run when the review opens. */
export async function chooseBackupRows(review: FullBackupReview, side: BackupSide, onlyTable?: string): Promise<BackupDecisions> {
  let decisions = await readBackupDecisions(review);
  for (const table of onlyTable ? [onlyTable] : Object.keys(review.plan.tables)) {
    let after: number | null = null;
    do {
      const page = await review.read({ kind: "rows", table, after, limit: 100 });
      if (page.kind !== "rows") throw new AppError("backup/changed", "Unexpected row review");
      const edits = page.entries.filter(row => row.selectable && row.selection !== side).map(row => ({ table, entryId: row.entryId, choice: side }));
      if (edits.length) {
        const receipt = await review.chooseRows({ expectedRevision: decisions.revision, edits });
        decisions = { ...decisions, revision: receipt.revision };
      }
      after = page.nextAfter;
    } while (after !== null);
  }
  return readBackupDecisions(review);
}
/** Bulk data choice keeps current executable code. Source-only programs remain
 * data-only until the user explicitly selects their code and approves it. */
export function chooseBackupData(model: BackupReviewModel, side: BackupSide): BackupReviewModel {
  return { ...model,
    fileChoices: Object.fromEntries(model.files.map(file => [file.path, side])),
    credentialChoices: Object.fromEntries(model.credentials.map(fact => [fact.slot, side === "source" ? "sourceLocal" : "targetLocal"])),
    programChoices: Object.fromEntries(model.programs.map(fact => {
      const target = fact.candidates.find(candidate => candidate.side === "target");
      return [fact.id, { program: target ? { side: target.side, root: target.root, sha256: target.sha256 } : null, data: side }];
    })),
  };
}
export function backupChoicesComplete(model: BackupReviewModel): boolean {
  return model.decisions.unresolved === 0 && model.files.every(file => model.fileChoices[file.path])
    && model.programs.every(program => model.programChoices[program.id]) && model.credentials.every(fact => model.credentialChoices[fact.slot]);
}

export function backupCellText(cell: BackupReviewCell | null, absent: string, nullText: string): string {
  if (!cell) return absent;
  if (cell.type === "null") return nullText;
  if (cell.type === "integer" || cell.type === "real") return cell.decimal;
  return cell.type === "text" && cell.text !== null ? cell.text : `base64: ${cell.base64}`;
}
