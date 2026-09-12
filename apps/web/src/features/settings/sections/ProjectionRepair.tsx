import { Alert, Body, Button, Dialog, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";
import { useProjectionRepair } from "../hooks/useProjectionRepair";
import { SettingsRow } from "../components/SettingsRow";

export function ProjectionRepair() {
  const { t } = useTranslation(["settings", "common"]);
  const { state, open, close, confirm } = useProjectionRepair();
  return <>
    <SettingsRow title={t("settings:about.diagnostics.repair.title")}
      description={t("settings:about.diagnostics.repair.description")}
      control={<Button variant="outline" size="sm" disabled={state !== null} onClick={open}>
        {t("settings:about.diagnostics.repair.check")}
      </Button>} />
    <Dialog open={state !== null} onClose={close} title={t("settings:about.diagnostics.repair.title")}>
      <div className="space-y-4">
        {state?.step === "checking" || state?.step === "working" ? <div role="status" className="flex items-center gap-2">
          <Spinner size="sm" /><Body>{t(state.step === "checking" ? "settings:about.diagnostics.repair.checking" : "settings:about.diagnostics.repair.working")}</Body>
        </div> : state?.step === "preview" ? <>
          <Body>{t(state.report.consistent ? "settings:about.diagnostics.repair.consistent" : "settings:about.diagnostics.repair.preview",
            { tables: state.report.driftedTables, live: state.report.onlyLiveRows, replay: state.report.onlyReplayedRows })}</Body>
          {!state.report.consistent && <Body>{t("settings:about.diagnostics.repair.warning")}</Body>}
        </> : state?.step === "done" ? <Body>{t("settings:about.diagnostics.repair.done")}</Body>
          : state?.step === "failed" ? <Alert variant="destructive">{describeError(state.error).body}</Alert> : null}
        <div className="flex justify-end gap-2">
          {state?.step === "done" ? <Button onClick={() => window.location.reload()}>{t("settings:about.diagnostics.repair.reload")}</Button>
            : state?.step !== "working" && <Button variant="ghost" onClick={close}>{t("settings:about.diagnostics.done")}</Button>}
          {state?.step === "preview" && !state.report.consistent && <Button variant="danger" onClick={() => void confirm()}>
            {t("settings:about.diagnostics.repair.confirm")}
          </Button>}
        </div>
      </div>
    </Dialog>
  </>;
}
