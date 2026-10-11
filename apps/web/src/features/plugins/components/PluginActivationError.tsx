import { Button, InlineError } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";

type PluginActivationErrorProps = {
  error: Error;
  /** A newer marketplace release, offered when the plugin is too old for this app. */
  update?: { version: string; busy: boolean; onUpdate: () => void };
  /** Leads to the app update check, offered when the plugin needs a newer app. */
  onCheckAppUpdate: () => void;
};

/** Why an installed plugin is not running, with the fix when one exists. */
export function PluginActivationError({ error, update, onCheckAppUpdate }: PluginActivationErrorProps) {
  const { t } = useTranslation(["plugins", "common"]);
  const described = describeError(error, { fallback: t("settings.activationError") });
  const linkClass = "h-auto p-0 align-baseline text-xs underline underline-offset-2";
  const action =
    described.action === "update-plugin" && update ? (
      <Button variant="link" disabled={update.busy} onClick={update.onUpdate} className={linkClass}>
        {t("settings.updateTo", { version: update.version })}
      </Button>
    ) : described.action === "update-app" ? (
      <Button variant="link" onClick={onCheckAppUpdate} className={linkClass}>
        {t("settings.checkAppUpdate")}
      </Button>
    ) : undefined;
  return (
    <InlineError compact action={action}>
      {described.body}
    </InlineError>
  );
}
