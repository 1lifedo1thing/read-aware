import { Body, Button, ChoiceGroup, Dialog, Progress, Stack, TextField } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { useBackupImport } from "../hooks/useBackupImport";
import { BackupImportReview } from "./BackupImportReview";

export type BackupImportFlow = ReturnType<typeof useBackupImport>;
export function BackupImportDialog({ flow }: { flow: BackupImportFlow }) {
  const { t } = useTranslation("settings");
  const view = flow.view;
  return <Dialog open={view !== null && view.step !== "consent"} onClose={flow.cancel} title={t("dataSync.importDialog.title")}
    className="w-full max-w-4xl max-h-[calc(100dvh-3rem)] overflow-y-auto">
    {view?.step === "form" ? <form onSubmit={event => { event.preventDefault(); void flow.submit(); }}><Stack gap="md">
      <ChoiceGroup label={t("dataSync.exportDialog.format")} value={view.format} onChange={format => flow.edit({ format })}
        options={[{ value: "full", label: t("dataSync.exportDialog.full") }, { value: "library", label: t("dataSync.exportDialog.library") }]} />
      <Body>{t(view.format === "full" ? "dataSync.importDialog.description" : "dataSync.exportDialog.libraryNotice")}</Body>
      {view.format === "full" && <TextField type="password" autoComplete="current-password" label={t("dataSync.exportDialog.password")}
        value={view.password} onChange={event => flow.edit({ password: event.target.value })} />}
      {view.error && <Body role="alert">{view.error === "password" ? t("dataSync.exportDialog.passwordError") : view.error}</Body>}
      <Stack direction="horizontal" justify="end" gap="sm"><Button type="button" variant="ghost" onClick={flow.cancel}>{t("dataSync.deleteAll.cancel")}</Button>
        <Button type="submit">{t("dataSync.importDialog.open")}</Button></Stack>
    </Stack></form> : view?.step === "running" ? <Stack gap="md">
      <div role="status" aria-live="polite"><Progress value={null} label={view.cancelling ? t("dataSync.exportDialog.cancelling") : t(`dataSync.importDialog.phases.${view.progress ?? "choosing"}`)} /></div>
      <Button variant="ghost" disabled={view.cancelling} onClick={flow.cancel}>{t("dataSync.deleteAll.cancel")}</Button>
    </Stack> : view?.step === "review" ? <BackupImportReview flow={flow} view={view} />
      : view?.step === "result" ? <Stack gap="md">
        <Body>{t("dataSync.importDialog.success", { rows: view.receipt.domainRows, files: view.receipt.files, plugins: view.receipt.plugins, credentials: view.receipt.credentials })}</Body>
        {view.receipt.cleanupPending && <Body>{t("dataSync.importDialog.cleanupPending")}</Body>}
        <Body>{t("dataSync.importDialog.reloadNotice")}</Body><Button onClick={flow.reload}>{t("dataSync.importDialog.reload")}</Button>
      </Stack> : view?.step === "failure" ? <Stack gap="md"><Body role="alert">{view.error}</Body>
        <Button onClick={view.restart ? flow.reload : flow.cancel}>{t(view.restart ? "dataSync.importDialog.reload" : "dataSync.importDialog.close")}</Button></Stack> : null}
  </Dialog>;
}
