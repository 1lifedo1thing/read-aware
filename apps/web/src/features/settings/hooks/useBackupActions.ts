import { actorFromEvent } from "../../../platform/domain-actor";
import { useLayoutEffect, useRef, useState } from "react";
import { AppError, errorCode, type BackupAction } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";
import { createLogger } from "../../../platform/logger";
import { hostBackupFlows, hostMaintenance } from "../../../services/maintenance";
import { useBackupImport, type BackupImportOutcome } from "./useBackupImport";
import { useBackupExport } from "./useBackupExport";

const log = createLogger("backup-actions");

export function useBackupActions(blocked = false) {
  const { t } = useTranslation("settings"), { toast } = useToast();
  const exportDialog = useBackupExport(), importDialog = useBackupImport();
  const [busy, setBusy] = useState(false), [requested, setRequested] = useState<BackupAction | null>(null);
  const active = useRef(false), pending = useRef<BackupAction | null>(null), lifetime = useRef<AbortController | null>(null);
  const unavailable = useRef(blocked); unavailable.current = blocked;
  useLayoutEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const off = hostBackupFlows.bind({
      open: request => {
        const { action } = request;
        if (active.current || unavailable.current) throw new AppError("ui/unavailable", "A native data action is already active");
        hostMaintenance.revealControl(`backup-${action}`, actorFromEvent(request));
        pending.current = action; setRequested(action);
      },
      close: () => { pending.current = null; setRequested(null); },
    });
    return () => { off(); controller.abort(); };
  }, []);

  const run = async (action: BackupAction) => {
    if (active.current || unavailable.current || pending.current && pending.current !== action) return;
    active.current = true; setBusy(true);
    const owner = lifetime.current;
    let operationSignal: AbortSignal | undefined, restarting = false;
    try {
      const result = await hostBackupFlows.run<boolean | BackupImportOutcome>(action, async signal => {
        const combined = signal && owner ? AbortSignal.any([signal, owner.signal]) : signal ?? owner?.signal;
        operationSignal = combined;
        return action === "import" ? importDialog.request(combined) : exportDialog.request(combined);
      });
      // A restore receipt keeps writes paused; its dialog owns the reload.
      if (result && typeof result === "object") { restarting = true; return; }
      if (!result || owner?.signal.aborted) return;
      toast({ variant: "success", title: t("dataSync.noticeDone"), description: t("dataSync.exportDialog.success") });
    } catch (error) {
      log.error(`Backup ${action} failed`, error);
      if (errorCode(error) === "backup/recovery-required") restarting = true;
      if (!owner?.signal.aborted && !operationSignal?.aborted) toast({ variant: "destructive", title: t("dataSync.noticeError"),
        description: describeError(error, { fallback: t(action === "export" ? "dataSync.exportError" : "dataSync.importError") }).body });
    } finally {
      active.current = restarting; pending.current = null;
      if (!owner?.signal.aborted) { setBusy(restarting); setRequested(null); }
    }
  };
  return { busy, requested, run, exportDialog, importDialog };
}
