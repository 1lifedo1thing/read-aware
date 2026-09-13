import { Channel } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { createFullBackupImport } from "../../src/features/settings/lib/full-backup-import-task";
import { applyFullBackup } from "../../src/features/settings/lib/full-backup-apply";
import { chooseBackupData, chooseBackupRows, loadBackupReviewModel } from "../../src/features/settings/lib/full-backup-review-model";
import { migrateFullBackupPrograms } from "../../src/features/settings/lib/full-backup-program-migration";
import { createLibraryDomain } from "../../src/domain/library";
import { getPluginBookAccess, requestInstallConsent } from "../../src/features/plugins/state/plugin-store";
import { parseManifestJson } from "../../src/features/plugins/lib/manifest";
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
const grantSnapshot = (value: unknown) => JSON.stringify(Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));

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

/** Reattach only the explicitly recorded owned ID after the required reload. */
export async function cleanupFull2RestoredGrantFixture(id: string) {
  await assertFull2BookAccessProfile();
  if (!/^full2-backup-grant-[0-9a-f-]{36}$/.test(id)) throw new Error("Not an owned fixture ID");
  const plugin = (await listPluginEntries()).find(plugin => plugin.id === id);
  if (!plugin || plugin.builtin || JSON.parse(plugin.manifest).name !== "Full2 Backup Grant Probe") throw new Error("Owned fixture identity mismatch");
  const reloadedGrant = getPluginBookAccess(id);
  const bookIds = (await createLibraryDomain("user").queries.books.list()).map(book => book.id);
  await uninstallPlugin(id);
  await localKV.removeItemAsync(`read-aware-plugin-host.schema.${id}`);
  await localKV.removeItemAsync(`read-aware-plugin.${id}.schedule-state`);
  await flushLocalKV();
  if ((await listPluginEntries()).some(plugin => plugin.id === id)) throw new Error("Fixture plugin remained");
  return { bookIds, reloadedGrant, cleaned: id };
}

/** Explicit synthetic consent, actual migration Worker and native transaction.
 * Successful apply holds production write barriers until the driver reloads.
 */
export async function runFull2BackupGrantApplyProbe(bookId: string, consent: "synthetic" | "dialog" = "synthetic") {
  await assertFull2BookAccessProfile();
  if (!fixture) throw new Error("Prepare fixture first");
  const current = fixture;
  const books = await createLibraryDomain("user").queries.books.list();
  if (!books.some(book => book.id === bookId)) throw new Error("Grant book missing");
  const beforeKV = await invoke<Record<string, string>>("load_kv_all");
  const priorGrants = JSON.parse(beforeKV["read-aware-plugins-book-access"] ?? "{}");
  const prepare = createFullBackupImport({
    id: () => crypto.randomUUID(), selectSource: async () => current.archive,
    open: (taskId, source, password) => invoke("backup_import_open", { taskId, source, password, progress: new Channel() }),
    plan: taskId => fence(() => invoke("backup_import_plan", { taskId, progress: new Channel() })),
    read: (taskId, query) => invoke("backup_import_review", { taskId, query }),
    checkRows: (taskId, expectedRevision) => invoke("backup_import_check_rows", { taskId, expectedRevision }),
    chooseRows: (taskId, request) => invoke("backup_import_choose_rows", { taskId, request }),
    stageProgram: (taskId, request) => invoke("backup_import_stage_program", { taskId, request }),
    stageStorage: (taskId, token, query) => invoke("backup_import_stage_storage", { taskId, token, query }),
    apply: applyFullBackup, cancel: taskId => invoke("backup_import_cancel", { taskId }),
    warn: message => { throw new Error(message); },
  });
  const review = await prepare(current.password);
  if (!review) throw new Error("Review missing");
  try {
    const model = chooseBackupData(await loadBackupReviewModel(review), "target");
    model.decisions = await chooseBackupRows(review, "target");
    const source = model.programs.find(program => program.id === current.id)?.candidates.find(candidate => candidate.side === "source");
    if (!source) throw new Error("Owned source candidate missing");
    model.programChoices[current.id] = { program: { side: source.side, root: source.root, sha256: source.sha256 }, data: "source" };
    const checked = await review.checkRows(model.decisions.revision);
    if (!checked.constraintsPassed || review.plan.conflictingEvents) throw new Error("Restore constraints failed");
    const grant = { mode: "book" as const, bookId };
    if (consent === "dialog") {
      const beforeConsent = await kvSnapshot();
      const beforePlugins = await listPluginEntries();
      const decision = await requestInstallConsent(parseManifestJson(source.manifest), undefined, books.map(book => ({ id: book.id, title: book.title })));
      if (!decision.approved) {
        if (JSON.stringify(beforeConsent) !== JSON.stringify(await kvSnapshot()) || JSON.stringify(beforePlugins) !== JSON.stringify(await listPluginEntries())) throw new Error("Consent cancellation changed native state");
        return { cancelled: true, nativeUnchanged: true, id: current.id };
      }
      if (grantSnapshot(decision.grant) !== grantSnapshot(grant)) throw new Error("Select the recorded fixture book in the consent dialog");
    }
    const programResults = await migrateFullBackupPrograms(review, new Map(Object.entries(model.programChoices)), new Map([[current.id, grant]]), await getVersion());
    if (!programResults[current.id]?.consented || JSON.stringify(programResults[current.id]?.bookAccess) !== JSON.stringify(grant)) throw new Error("Selected grant lost before apply");
    const receipt = await review.apply({ rowRevision: model.decisions.revision, files: model.fileChoices, programs: model.programChoices, credentials: model.credentialChoices, programResults });
    const persisted = await invoke<Record<string, string>>("load_kv_all");
    const grants = JSON.parse(persisted["read-aware-plugins-book-access"] ?? "{}");
    if (grantSnapshot(grants[current.id]) !== grantSnapshot(grant)) throw new Error("Restored grant differs from selection");
    for (const [id, value] of Object.entries(priorGrants)) if (grantSnapshot(grants[id]) !== grantSnapshot(value)) throw new Error(`Existing grant changed: ${id}`);
    if (!(await listPluginEntries()).some(plugin => plugin.id === current.id)) throw new Error("Restored plugin files missing");
    return { receipt, id: current.id, archive: current.archive, grant: grants[current.id], priorGrantsPreserved: true, expectedBookIds: books.map(book => book.id), requiresReload: true, boundary: `${consent} consent choice through real migration Worker and native apply` };
  } finally { await review.dispose(); }
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
