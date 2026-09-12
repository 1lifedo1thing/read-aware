import { Body, Button, ChoiceGroup, Dialog, Progress, Stack, TextField } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { useBackupExport } from "../hooks/useBackupExport";

export function BackupExportDialog({ flow }: { flow: Pick<ReturnType<typeof useBackupExport>, "view" | "edit" | "submit" | "cancel"> }) {
  const { t } = useTranslation("settings");
  const view = flow.view;
  const progress = view?.step === "running" ? view.progress : null;
  const progressValue = progress?.phase === "database" && progress.totalPages > 0
    ? (progress.totalPages - progress.remainingPages) / progress.totalPages * 100 : null;
  const progressLabel = view?.step === "running" && view.cancelling ? t("dataSync.exportDialog.cancelling")
    : view?.step === "running" && view.format === "library" ? t("dataSync.working")
    : t(`dataSync.exportDialog.phases.${progress?.phase ?? "choosing"}`);
  return <Dialog open={view !== null} onClose={flow.cancel} title={t("dataSync.exportDialog.title")} className="max-h-[calc(100dvh-3rem)] overflow-y-auto">
    {view?.step === "form" ? <form onSubmit={event => { event.preventDefault(); void flow.submit(); }}>
      <Stack gap="md">
        <ChoiceGroup label={t("dataSync.exportDialog.format")} value={view.form.format} onChange={format => flow.edit({ format })}
          options={[{ value: "full", label: t("dataSync.exportDialog.full") }, { value: "library", label: t("dataSync.exportDialog.library") }]} />
        <Body>{t(view.form.format === "full" ? "dataSync.exportDialog.fullDescription" : "dataSync.fullBackup.description")}</Body>
        {view.form.format === "full" ? <>
          <TextField label={t("dataSync.exportDialog.password")} type="password" autoComplete="new-password" spellCheck={false}
            value={view.form.password} onChange={event => flow.edit({ password: event.target.value })}
            helperText={t("dataSync.exportDialog.passwordHint")} error={view.form.passwordError ? t("dataSync.exportDialog.passwordError") : undefined} />
          <TextField label={t("dataSync.exportDialog.confirmation")} type="password" autoComplete="new-password" spellCheck={false}
            value={view.form.confirmation} onChange={event => flow.edit({ confirmation: event.target.value })}
            error={view.form.confirmationError ? t("dataSync.exportDialog.confirmationError") : undefined} />
        </> : <Body>{t("dataSync.exportDialog.libraryNotice")}</Body>}
        <Stack direction="horizontal" justify="end" gap="sm">
          <Button type="button" variant="ghost" onClick={flow.cancel}>{t("dataSync.deleteAll.cancel")}</Button>
          <Button type="submit">{t("dataSync.exportDialog.save")}</Button>
        </Stack>
      </Stack>
    </form> : view?.step === "running" ? <Stack gap="md">
      <Stack role="status" aria-live="polite"><Progress value={progressValue} label={progressLabel} /></Stack>
      <Stack direction="horizontal" justify="end"><Button variant="ghost" disabled={view.cancelling} onClick={flow.cancel}>{t("dataSync.deleteAll.cancel")}</Button></Stack>
    </Stack> : null}
  </Dialog>;
}
