import { Button, Caption, InlineError, Stack, TextField, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { useLocalApi } from "../hooks/useLocalApi";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";

export function LocalApiPanel() {
  const { t } = useTranslation("settings");
  const state = useLocalApi();
  if (!state.supported) return null;
  return <SettingsGroup title={t("localApi.title")}>
    <Stack gap="lg">
      <SettingsRow borderless title={t("localApi.enabled")} description={t("localApi.description")}
        control={<Toggle aria-label={t("localApi.enabled")} checked={state.status?.enabled ?? false}
          disabled={state.busy || !state.status} onChange={enabled => void state.change(enabled)} />} />
      {state.error && <InlineError>{state.error}</InlineError>}
      {!state.status && state.error && <div><Button variant="outline" size="sm" onClick={() => void state.refresh()}>{t("localApi.refresh")}</Button></div>}
      {state.status?.enabled && <>
        <TextField label={t("localApi.address")} value={state.status.baseUrl} readOnly />
        <Caption role="status">{state.status.running ? t("localApi.running") : t("localApi.stopped")}</Caption>
        {!state.status.running && <div><Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.retry()}>{t("localApi.start")}</Button></div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.copyConnection()}>{t("localApi.copyConnection")}</Button>
          <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void state.rotate()}>{t("localApi.rotate")}</Button>
        </div>
      </>}
      <Caption>{t("localApi.skillHint")}</Caption>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.copyInstallPrompt()}>{t("localApi.copyInstallPrompt")}</Button>
        <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void state.openSkill()}>{t("localApi.viewSkill")}</Button>
      </div>
    </Stack>
  </SettingsGroup>;
}
