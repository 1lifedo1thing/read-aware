import { Eye, EyeSlash } from "@phosphor-icons/react";
import { WEB_PROVIDERS } from "@read-aware/agent";
import { Button, Caption, IconButton, InlineError, Select, Stack, TextField, Toggle } from "@read-aware/ui";
import { useExternalLink } from "../../../hooks/useExternalLink";
import { useTranslation } from "../../../i18n";
import { useSearchConfig } from "../hooks/useSearchConfig";
import { SettingsRow } from "./SettingsRow";

export function SearchConfigPanel() {
  const { t } = useTranslation("settings");
  const state = useSearchConfig();
  const openExternalLink = useExternalLink();
  return <Stack gap="lg">
    {state.readError && <InlineError>{state.readError}</InlineError>}
    <SettingsRow borderless title={t("search.enabled")} description={t("search.description")}
      control={<Toggle aria-label={t("search.enabled")} checked={state.config.enabled}
        onChange={enabled => state.change({ enabled })} />} />
    <Select label={t("search.provider")} value={state.config.provider} onChange={state.changeProvider}
      options={Object.entries(WEB_PROVIDERS).map(([value, provider]) => ({ value, label: provider.label }))} />
    <TextField label={t("search.apiKey")} type={state.showKey ? "text" : "password"} autoComplete="off"
      value={state.config.apiKey} onChange={event => state.change({ apiKey: event.target.value })} onBlur={state.flush}
      placeholder={t("search.keyPlaceholder")}
      trailingAction={<IconButton size="sm" label={state.showKey ? t("aiConfig.hide") : t("aiConfig.show")}
        onClick={() => state.setShowKey(!state.showKey)} icon={state.showKey ? <EyeSlash /> : <Eye />} />} />
    <Caption>{t("search.keyHint")}{" "}<a className="underline underline-offset-4" href={WEB_PROVIDERS[state.config.provider].keyUrl}
      onClick={openExternalLink} target="_blank" rel="noreferrer">{t("search.getKey")}</a></Caption>
    <div><Button variant="outline" size="sm" disabled={state.testing || !state.config.apiKey.trim()} onClick={() => void state.test()}>
      {state.testing ? t("search.testing") : t("search.test")}
    </Button></div>
    {state.result?.success && <Caption role="status">{state.result.message}</Caption>}
    {state.result && !state.result.success && <InlineError>{state.result.message}</InlineError>}
  </Stack>;
}
