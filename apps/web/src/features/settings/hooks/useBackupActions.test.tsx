import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { AppError, type BackupReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import { hostMaintenance } from "../../../services/maintenance";
import { workspace } from "../../../services/workspace";
import { backupFileActions } from "../lib/backup-file-actions";
import { useBackupActions } from "./useBackupActions";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";
import { BackupImportDialog } from "../components/BackupImportDialog";
import { BackupExportDialog } from "../components/BackupExportDialog";
import * as fullBackup from "../lib/full-backup-export";
import type { FullBackupProgress } from "../lib/full-backup-export-task";

if (process.env.BACKUP_HOOK_CASE === "1") {
test("actor backup requests await a real host click, preserve cancellation and return final status only", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let exports = 0, imports = 0, focused = "", saveResult = false;
  let fullCalls = 0, fullSignal: AbortSignal | undefined, notify: ((progress: FullBackupProgress) => void) | undefined;
  let fullResult = Promise.withResolvers<boolean>();
  const importMock = spyOn(backupFileActions, "import").mockImplementation(async () => { imports++; return null; });
  const mocks = [spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never),
    spyOn(backupFileActions, "export").mockImplementation(async () => { exports++; return saveResult; }),
    importMock, spyOn(fullBackup, "exportFullBackup").mockImplementation(async (password, signal, progress) => {
      expect(password).toBe("private backup password"); fullCalls++; fullSignal = signal; notify = progress;
      return fullResult.promise;
    })];
  const controls = [hostMaintenance.bindSurface("backup-export", () => { focused = "export"; }), hostMaintenance.bindSurface("backup-import", () => { focused = "import"; })];
  const actor = buildPluginContext({ id: "backup-test", name: "Backup", version: "1", schemaVersion: 1,
    requires: { services: { maintenance: "^1.2.0" } }, permissions: [] }, "1", []);
  actor.lifecycle.promote();
  let flow!: ReturnType<typeof useBackupActions>;
  function Harness() { flow = useBackupActions(); return <><button onClick={() => void flow.run("export")}>Export</button><BackupExportDialog flow={flow.exportDialog} /><BackupImportDialog flow={flow.importDialog} /></>; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => Bun.sleep(0);
  const importLibrary = async () => {
    await act(async () => { void flow.run("import"); await tick(); });
    await act(async () => { flow.importDialog.edit({ format: "library" }); });
    await act(async () => { await flow.importDialog.submit(); await tick(); });
  };
  try {
    await initI18n("en");
    Object.assign(dom.window, { __TAURI_INTERNALS__: {} });
    await act(async () => { root.render(<StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>); });
    let request!: Promise<BackupReceipt>;
    for (const save of [false, true]) {
      saveResult = save;
      const before = exports;
      await act(async () => { request = actor.context.services.maintenance.requestBackup("export"); await tick(); });
      expect(focused).toBe("export"); expect(flow.requested).toBe("export"); expect(exports).toBe(before);
      await act(async () => { await flow.run("import"); }); expect(imports).toBe(0);
      await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
      expect(exports).toBe(before); expect(fullCalls).toBe(0);
      await act(async () => { flow.exportDialog.edit({ format: "library" }); });
      await act(async () => { await flow.exportDialog.submit(); });
      expect(await request).toEqual({ action: "export", status: save ? "exported" : "cancelled" });
      expect(exports).toBe(before + 1); expect(flow.busy).toBe(false);
      if (save) {
        expect(dom.window.document.body.textContent).toContain("Library backup (v1) exported.");
        expect(dom.window.document.body.textContent).not.toContain("readaware-backup.json");
      }
    }
    // A host click opens the form, never dispatches encryption or reveals its
    // password to the actor. Validation stays in fields, without a task.
    await act(async () => { request = actor.context.services.maintenance.requestBackup("export"); await tick(); });
    await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
    await act(async () => { await flow.exportDialog.submit(); });
    expect(fullCalls).toBe(0); expect(dom.window.document.querySelector('[aria-invalid="true"]')).not.toBeNull();
    await act(async () => { flow.exportDialog.edit({ password: "private backup password", confirmation: "wrong" }); });
    await act(async () => { await flow.exportDialog.submit(); }); expect(fullCalls).toBe(0);
    await act(async () => { flow.exportDialog.edit({ confirmation: "private backup password" }); });
    let submitted!: Promise<void>;
    await act(async () => { submitted = flow.exportDialog.submit(); await tick(); });
    expect(fullCalls).toBe(1); expect(flow.busy).toBe(true); expect(dom.window.document.querySelector('input[type="password"]')).toBeNull();
    await act(async () => { notify?.({ phase: "database", remainingPages: 1, totalPages: 4 }); });
    expect(dom.window.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("75");
    let settled = false; void request.then(() => { settled = true; });
    await act(async () => { flow.exportDialog.cancel(); await tick(); });
    expect(fullSignal?.aborted).toBe(true); expect(settled).toBe(false); expect(flow.busy).toBe(true);
    expect(dom.window.document.body.textContent).toContain("waiting for cleanup");
    await act(async () => { fullResult.reject(new DOMException("Aborted", "AbortError")); await submitted; await tick(); });
    expect(await request).toEqual({ action: "export", status: "cancelled" }); expect(flow.busy).toBe(false);
    fullResult = Promise.withResolvers<boolean>();
    await act(async () => { request = actor.context.services.maintenance.requestBackup("export"); await tick(); });
    await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
    await act(async () => { flow.exportDialog.edit({ password: "private backup password", confirmation: "private backup password" }); });
    await act(async () => { submitted = flow.exportDialog.submit(); await tick(); });
    // A late user cancellation cannot retract an already successful native save.
    await act(async () => { flow.exportDialog.cancel(); });
    await act(async () => { fullResult.resolve(true); await submitted; await tick(); });
    expect(await request).toEqual({ action: "export", status: "exported" });
    expect(dom.window.document.body.textContent).toContain("Complete encrypted backup saved.");
    expect(dom.window.document.body.textContent).not.toContain("private backup password");
    const formOwner = new AbortController();
    await act(async () => { request = actor.context.services.maintenance.requestBackup("export", { signal: formOwner.signal }); await tick(); });
    const abandoned = request.catch(error => error);
    await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
    await act(async () => { flow.exportDialog.edit({ password: "not submitted" }); });
    const beforeAbandon = fullCalls;
    await act(async () => { formOwner.abort(); await abandoned; await tick(); });
    expect((await abandoned).name).toBe("AbortError"); expect(fullCalls).toBe(beforeAbandon);
    expect(flow.exportDialog.view).toBeNull(); expect(flow.busy).toBe(false);
    // Leaving settings aborts its owned work but keeps the actor pending until
    // the physical task has cleaned up. A remount cannot inherit its form.
    fullResult = Promise.withResolvers<boolean>();
    await act(async () => { request = actor.context.services.maintenance.requestBackup("export"); await tick(); });
    await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
    await act(async () => { flow.exportDialog.edit({ password: "private backup password", confirmation: "private backup password" }); });
    await act(async () => { submitted = flow.exportDialog.submit(); await tick(); });
    settled = false; void request.then(() => { settled = true; });
    await act(async () => { root.render(null); await tick(); });
    expect(fullSignal?.aborted).toBe(true); expect(settled).toBe(false);
    await act(async () => { fullResult.reject(new DOMException("Aborted", "AbortError")); await submitted; await tick(); });
    expect(await request).toEqual({ action: "export", status: "cancelled" });
    await act(async () => { root.render(<StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>); });
    expect(flow.exportDialog.view).toBeNull();
    await act(async () => { request = actor.context.services.maintenance.requestBackup("import"); await tick(); });
    expect(imports).toBe(0); await importLibrary();
    expect(await request).toEqual({ action: "import", status: "cancelled" }); expect(imports).toBe(1);
    const signal = new AbortController();
    await act(async () => { request = actor.context.services.maintenance.requestBackup("export", { signal: signal.signal }); await tick(); });
    const rejected = request.catch(error => error);
    await act(async () => { signal.abort(); await rejected; await tick(); });
    expect(flow.requested).toBeNull(); expect(exports).toBe(2);
    importMock.mockRejectedValueOnce(new AppError("plugin/data-busy", "PRIVATE RAW MIGRATION TEXT"));
    await act(async () => { request = actor.context.services.maintenance.requestBackup("import"); await tick(); });
    const busyResult = request.catch(error => error);
    await importLibrary();
    expect(await busyResult).toMatchObject({ code: "plugin/data-busy" });
    const common = await Bun.file(new URL("../../../i18n/locales/en/common.json", import.meta.url)).json();
    expect(dom.window.document.body.textContent).toContain(common.errors.pluginDataBusy);
    expect(dom.window.document.body.textContent).not.toContain("PRIVATE RAW MIGRATION TEXT");
    expect(flow.busy).toBe(false);
    importMock.mockResolvedValueOnce({ books: 1, collections: 2, annotations: 3, settings: 4 });
    await act(async () => { request = actor.context.services.maintenance.requestBackup("import"); await tick(); });
    await importLibrary();
    expect(await request).toEqual({ action: "import", status: "imported" }); expect(flow.busy).toBe(true);
    await act(async () => { actor.lifecycle.stop(); });
    expect(() => actor.context.services.maintenance.requestBackup("export")).toThrow();
  } finally {
    actor.lifecycle.stop(); await act(async () => { root.unmount(); });
    controls.forEach(off => off()); mocks.forEach(mock => mock.mockRestore()); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated mounted backup action contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, BACKUP_HOOK_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
