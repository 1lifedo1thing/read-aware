import { causalActor } from "../../../platform/domain-actor";
import { useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { AppError, errorCode } from "@read-aware/core";
import { getVersion } from "@tauri-apps/api/app";
import type { PluginBookAccess } from "@read-aware/plugin-types";
import { describeError } from "../../../i18n/describe-error";
import { createLogger } from "../../../platform/logger";
import { libraryBooksAtom } from "../../library/state/library-store";
import { requestInstallConsent } from "../../plugins/state/plugin-store";
import { backupFileActions } from "../lib/backup-file-actions";
import type { BackupImportResult } from "../lib/backup-io";
import { validBackupPassword } from "../lib/backup-password";
import { prepareFullBackupImport } from "../lib/full-backup-import";
import type { FullBackupReview, FullBackupImportProgress } from "../lib/full-backup-import-task";
import type { FullBackupRestoreReceipt } from "../lib/full-backup-apply";
import { reviewFullBackupPrograms } from "../lib/full-backup-program-review";
import { migrateFullBackupPrograms } from "../lib/full-backup-program-migration";
import { backupChoicesComplete, chooseBackupData, chooseBackupRows, loadBackupReviewModel, readBackupDecisions,
  type BackupReviewModel, type BackupRowsPage, type BackupFieldsPage } from "../lib/full-backup-review-model";
import type { BackupReviewPage } from "../lib/backup-review-types";
import type { BackupSide } from "../../plugins/runtime/backup-program-review";

export type BackupImportOutcome = BackupImportResult | FullBackupRestoreReceipt | null;
type ReviewView = { step: "review"; review: FullBackupReview; model: BackupReviewModel; table: string; rows: BackupRowsPage | null;
  catalogPages: Record<"files" | "programs" | "credentials", number>; fields: BackupFieldsPage | null; issues: Extract<BackupReviewPage, { kind: "rowIssues" }> | null; busy: boolean; error?: string; confirmed: boolean };
type View = { step: "form"; format: "full" | "library"; password: string; error?: string }
  | { step: "running"; progress: FullBackupImportProgress | "migrating" | null; cancelling: boolean }
  | ReviewView | { step: "consent" } | { step: "result"; receipt: FullBackupRestoreReceipt }
  | { step: "failure"; error: string; restart: boolean };
type Flight = { controller: AbortController; signal: AbortSignal; review?: FullBackupReview;
  resolve(result: BackupImportOutcome): void; reject(error: unknown): void; cleanup(): void; running: boolean };
const log = createLogger("backup-import");

export function useBackupImport() {
  const [view, setView] = useState<View | null>(null);
  const libraryBooks = useAtomValue(libraryBooksAtom);
  const flight = useRef<Flight | null>(null), mounted = useRef(false), currentView = useRef(view);
  const publish = (value: View | null) => { currentView.current = value; if (mounted.current) setView(value); };
  const finish = (current: Flight, result: BackupImportOutcome, error?: unknown) => {
    if (flight.current !== current) return;
    flight.current = null; current.cleanup();
    if (error !== undefined) current.reject(error); else current.resolve(result);
  };
  const cancelFlight = async (current: Flight) => {
    await current.review?.dispose();
    if (flight.current === current) { publish(null); finish(current, null); }
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flight.current?.controller.abort(); };
  }, []);
  const request = (external?: AbortSignal): Promise<BackupImportOutcome> => {
    external?.throwIfAborted();
    if (!mounted.current || flight.current) return Promise.reject(new AppError("ui/unavailable", "Backup import surface is unavailable"));
    return new Promise((resolve, reject) => {
      const controller = new AbortController(), signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
      const current: Flight = { controller, signal, resolve, reject, running: false, cleanup: () => signal.removeEventListener("abort", abort) };
      const abort = () => {
        if (!current.running) void cancelFlight(current);
        else if (currentView.current?.step === "running") publish({ ...currentView.current, cancelling: true });
      };
      flight.current = current; signal.addEventListener("abort", abort, { once: true });
      publish({ step: "form", format: "full", password: "" });
    });
  };
  const progress = (value: FullBackupImportProgress | "migrating") => {
    if (currentView.current?.step === "running") publish({ ...currentView.current, progress: value });
  };
  const edit = (patch: { format?: "full" | "library"; password?: string }) => {
    const value = currentView.current;
    if (value?.step === "form") publish({ ...value, ...patch, error: undefined, ...(patch.format ? { password: "" } : {}) });
  };
  const submit = async () => {
    const current = flight.current, value = currentView.current;
    if (!current || current.running || value?.step !== "form") return;
    if (value.format === "full" && !validBackupPassword(value.password)) { publish({ ...value, error: "password" }); return; }
    current.running = true; publish({ step: "running", progress: null, cancelling: false });
    try {
      if (value.format === "library") {
        const result = await backupFileActions.import(current.signal); publish(null); finish(current, result); return;
      }
      const review = await prepareFullBackupImport(value.password, current.signal, progress);
      if (!review) { publish(null); finish(current, null); return; }
      current.review = review;
      const model = await loadBackupReviewModel(review);
      current.signal.throwIfAborted();
      publish({ step: "review", review, model, table: "", rows: null, catalogPages: { files: 0, programs: 0, credentials: 0 }, fields: null, issues: null, busy: false, confirmed: false });
    } catch (error) {
      log.warn("Backup preparation failed", error);
      await current.review?.dispose(); current.review = undefined;
      if (current.signal.aborted) { publish(null); finish(current, null); }
      else if (value.format === "library") { publish(null); finish(current, null, error); }
      else publish({ step: "form", format: value.format, password: "", error: describeError(error).body });
    } finally { current.running = false; }
  };
  const reviewWork = async (operation: (value: ReviewView, current: Flight) => Promise<ReviewView>) => {
    const current = flight.current, value = currentView.current;
    if (!current || current.running || value?.step !== "review" || value.busy) return;
    current.running = true; publish({ ...value, busy: true, error: undefined });
    try {
      const next = await operation(value, current);
      current.signal.throwIfAborted(); publish({ ...next, busy: false });
    } catch (error) {
      log.warn("Backup review failed", error);
      if (current.signal.aborted) await cancelFlight(current);
      else publish({ ...value, busy: false, error: describeError(error).body });
    } finally { current.running = false; }
  };
  const rows = async (review: FullBackupReview, table: string, after: number | null = null) => {
    const page = await review.read({ kind: "rows", table, after, limit: 20 });
    if (page.kind !== "rows") throw new AppError("backup/changed", "Unexpected row page");
    return page;
  };
  const selectTable = (table: string, after: number | null = null) => reviewWork(async value => ({ ...value, table, rows: await rows(value.review, table, after), fields: null }));
  const bulk = (side: BackupSide) => reviewWork(async value => {
    const decisions = await chooseBackupRows(value.review, side);
    return { ...value, model: { ...chooseBackupData(value.model, side), decisions }, confirmed: false, issues: null,
      rows: value.table ? await rows(value.review, value.table) : null, fields: null };
  });
  const chooseRow = (entryId: number, choice: "source" | "target" | "clear") => reviewWork(async value => {
    await value.review.chooseRows({ expectedRevision: value.model.decisions.revision, edits: [{ table: value.table, entryId, choice }] });
    const decisions = await readBackupDecisions(value.review);
    return { ...value, model: { ...value.model, decisions }, confirmed: false, issues: null,
      rows: value.rows ? { ...value.rows, decisionRevision: decisions.revision, entries: value.rows.entries.map(row => row.entryId === entryId ? { ...row, selection: choice === "clear" ? null : choice } : row) } : null };
  });
  const inspectRow = (entryId: number, after: number | null = null) => reviewWork(async value => {
    const page = await value.review.read({ kind: "rowFields", table: value.table, entryId, after, limit: 20 });
    if (page.kind !== "rowFields") throw new AppError("backup/changed", "Unexpected fields page");
    return { ...value, fields: page };
  });
  const fieldChunk = (column: string, side: BackupSide, offset: number) => reviewWork(async value => {
    if (!value.fields) return value;
    const page = await value.review.read({ kind: "rowField", table: value.table, entryId: value.fields.entryId, column, side, offset });
    if (page.kind !== "rowField") throw new AppError("backup/changed", "Unexpected field chunk");
    return { ...value, fields: { ...value.fields, entries: value.fields.entries.map(field => field.name === column ? { ...field, [side]: page.value } : field) } };
  });
  const editChoices = (patch: Partial<Pick<BackupReviewModel, "fileChoices" | "programChoices" | "credentialChoices">>) => {
    const value = currentView.current;
    if (value?.step === "review" && !value.busy) publish({ ...value, model: { ...value.model, ...patch }, confirmed: false, error: undefined });
  };
  const check = () => reviewWork(async value => {
    if (!backupChoicesComplete(value.model)) throw new AppError("backup/incomplete", "Some restore choices remain unresolved");
    if (value.review.plan.conflictingEvents) throw new AppError("backup/incomplete", "Source has conflicting immutable event identities");
    const checked = await value.review.checkRows(value.model.decisions.revision);
    const page = await value.review.read({ kind: "rowIssues", expectedRevision: checked.revision, limit: 100 });
    if (page.kind !== "rowIssues") throw new AppError("backup/changed", "Unexpected row issues");
    return { ...value, issues: page, confirmed: checked.constraintsPassed };
  });
  const restore = async () => {
    const current = flight.current, value = currentView.current;
    if (!current || current.running || value?.step !== "review" || !value.confirmed || !backupChoicesComplete(value.model)) return;
    const origin = causalActor("user");
    current.running = true; publish({ ...value, busy: true });
    try {
      const choices = new Map(Object.entries(value.model.programChoices));
      const version = await getVersion();
      const programs = await reviewFullBackupPrograms(value.review, choices, version, current.signal);
      const grants = new Map<string, PluginBookAccess>();
      const books = libraryBooks.map(({ id, title }) => ({ id, title }));
      for (const program of programs) {
        if (!program.consentRequired || !program.manifest) continue;
        publish({ step: "consent" });
        const consent = await requestInstallConsent(program.manifest, current.signal, books);
        current.signal.throwIfAborted();
        if (!consent.approved) { publish({ ...value, busy: false }); return; }
        grants.set(program.id, structuredClone(consent.grant));
      }
      publish({ step: "running", progress: "migrating", cancelling: false });
      const programResults = await migrateFullBackupPrograms(value.review, choices, grants, version, current.signal, origin);
      current.signal.throwIfAborted();
      progress("restoring");
      const receipt = await value.review.apply({ rowRevision: value.model.decisions.revision, files: value.model.fileChoices,
        programs: value.model.programChoices, credentials: value.model.credentialChoices, programResults }, origin);
      await value.review.dispose();
      publish({ step: "result", receipt }); finish(current, receipt);
    } catch (error) {
      log.error("Full backup restore failed", error);
      if (errorCode(error) === "backup/recovery-required") {
        await value.review.dispose(); publish({ step: "failure", error: describeError(error).body, restart: true }); finish(current, null, error);
      } else if (current.signal.aborted) await cancelFlight(current);
      else if (value.review.disposed) {
        await value.review.dispose(); publish({ step: "failure", error: describeError(error).body, restart: false }); finish(current, null, error);
      } else publish({ ...value, busy: false, error: describeError(error).body });
    } finally { current.running = false; }
  };
  const catalogPage = (kind: "files" | "programs" | "credentials", page: number) => {
    const value = currentView.current;
    if (value?.step === "review" && !value.busy) publish({ ...value, catalogPages: { ...value.catalogPages, [kind]: page } });
  };
  const cancel = () => {
    if (view?.step === "result" || view?.step === "failure" && view.restart) { window.location.reload(); return; }
    if (flight.current) flight.current.controller.abort(); else publish(null);
  };
  return { view, request, edit, submit, cancel, bulk, selectTable, chooseRow, inspectRow, fieldChunk, editChoices, catalogPage, check, restore, reload: () => window.location.reload() };
}
