import { useLayoutEffect, useRef, useState } from "react";
import { AppError } from "@read-aware/core";
import { backupFileActions } from "../lib/backup-file-actions";
import { validBackupPassword } from "../lib/backup-password";
import type { FullBackupProgress } from "../lib/full-backup-export-task";

export type BackupExportFormat = "full" | "library";
type Result = { saved: boolean; format: BackupExportFormat };
type Form = { format: BackupExportFormat; password: string; confirmation: string; passwordError: boolean; confirmationError: boolean };
type View = { step: "form"; form: Form } | { step: "running"; format: BackupExportFormat; progress: FullBackupProgress | null; cancelling: boolean };
type Flight = {
  phase: "form" | "running";
  controller: AbortController;
  signal: AbortSignal;
  resolve(result: Result): void;
  reject(error: unknown): void;
  cleanup(): void;
  format: BackupExportFormat;
};
const emptyForm = (): Form => ({ format: "full", password: "", confirmation: "", passwordError: false, confirmationError: false });

/** Owns a host-only interactive export. Cancellation/unmount closes a pending
 * form immediately, but never releases a running native task before receipt. */
export function useBackupExport() {
  const [view, setView] = useState<View | null>(null);
  const flight = useRef<Flight | null>(null), mounted = useRef(false);
  const finish = (current: Flight, result: boolean, error?: unknown) => {
    if (flight.current !== current) return;
    flight.current = null; current.cleanup();
    if (mounted.current) setView(null);
    if (error !== undefined) current.reject(error);
    else current.resolve({ saved: result, format: current.format });
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flight.current?.controller.abort(); };
  }, []);

  const request = (external?: AbortSignal): Promise<Result> => {
    external?.throwIfAborted();
    if (!mounted.current || flight.current) return Promise.reject(new AppError("ui/unavailable", "Backup export surface is unavailable"));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
      const current: Flight = { phase: "form", controller, signal, resolve, reject, format: "full", cleanup: () => signal.removeEventListener("abort", abort) };
      function abort() {
        if (current.phase === "form") finish(current, false);
        else if (mounted.current) setView(value => value?.step === "running" ? { ...value, cancelling: true } : value);
      }
      flight.current = current;
      signal.addEventListener("abort", abort, { once: true });
      setView({ step: "form", form: emptyForm() });
    });
  };
  const edit = (patch: Partial<Pick<Form, "format" | "password" | "confirmation">>) => {
    if (flight.current?.phase !== "form") return;
    if (patch.format) flight.current.format = patch.format;
    setView(value => value?.step === "form" ? { step: "form", form: {
      ...value.form, ...patch, passwordError: false, confirmationError: false,
      ...(patch.format ? { password: "", confirmation: "" } : {}),
    } } : value);
  };
  const submit = async () => {
    const current = flight.current;
    if (!current || current.phase !== "form" || view?.step !== "form") return;
    const { format, password, confirmation } = view.form;
    const passwordError = format === "full" && !validBackupPassword(password);
    const confirmationError = format === "full" && password !== confirmation;
    if (passwordError || confirmationError) {
      setView({ step: "form", form: { ...view.form, passwordError, confirmationError } }); return;
    }
    current.phase = "running"; current.format = format;
    // Remove both password fields from React state/DOM before native work.
    setView({ step: "running", format, progress: null, cancelling: false });
    try {
      current.signal.throwIfAborted();
      const saved = format === "library" ? await backupFileActions.export(current.signal)
        : await (await import("../lib/full-backup-export")).exportFullBackup(password, current.signal, progress => {
          if (mounted.current && flight.current === current) setView(value => value?.step === "running" ? { ...value, progress } : value);
        });
      finish(current, saved);
    } catch (error) {
      // A user/owner abort is cancellation, not a failure toast. The task has
      // already settled physically; successful publication takes the path above.
      finish(current, false, current.signal.aborted ? undefined : error);
    }
  };
  return { view, request, edit, submit, cancel: () => flight.current?.controller.abort() };
}
