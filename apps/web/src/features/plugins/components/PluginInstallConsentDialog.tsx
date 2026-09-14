/**
 * The install-time disclosure gate (docs/plugins/plugin-system.md §2 — installation
 * is the trust boundary): who the plugin is, the trust warning, and every
 * declared permission spelled out, before any file lands or code runs.
 */
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { Badge, Button, Caption, Dialog, InlineError } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  permissionLabelKey,
  permissionNameKey,
  type PluginBookAccess,
} from "../lib/plugin-types";
import { pluginInstallConsentAtom } from "../state/plugin-store";
import {
  isValidPluginBookAccess,
  PluginBookAccessSelector,
} from "./PluginBookAccessSelector";

export function PluginInstallConsentDialog() {
  const { t } = useTranslation("plugins");
  const request = useAtomValue(pluginInstallConsentAtom);
  const [grant, setGrant] = useState<PluginBookAccess>({ mode: "all" });
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const manifest = request?.manifest;
  const permissions = manifest?.permissions ?? [];
  const settingsAccess = manifest?.settingsAccess;
  const networkOrigins = manifest?.networkAccess?.origins ?? [];
  const books = request?.books ?? [];
  const settingGrants = (["discover", "read", "write"] as const).flatMap(
    (operation) =>
      (settingsAccess?.[operation] ?? []).map((path) => ({ operation, path })),
  );

  useEffect(() => {
    setGrant({ mode: "all" });
    setBusy(false);
    setInvalid(false);
  }, [request]);

  const valid = isValidPluginBookAccess(grant, books);

  const cancel = () => {
    if (!busy) request?.resolve(false);
  };

  const confirm = () => {
    if (!request || busy) return;
    if (!valid) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setInvalid(false);
    try {
      request.resolve(true, grant);
    } catch {
      // Consent resolvers normally only settle the waiting install promise;
      // preserve the gate if a host surface rejects synchronously.
      setBusy(false);
      setInvalid(true);
    }
  };

  return (
    <Dialog
      open={request !== null}
      onClose={cancel}
      title={manifest ? t("settings.installConfirm.title", { name: manifest.name }) : ""}
      className="w-full max-w-md"
    >
      {manifest && (
        <div className="flex flex-col gap-3">
          <Caption className="text-fg-subtle">
            v{manifest.version}
            {manifest.author ? ` · ${manifest.author}` : ""}
          </Caption>
          {manifest.description && (
            <p className="font-sans text-sm text-fg-muted">{manifest.description}</p>
          )}

          <p className="border-l-2 border-border pl-3 font-sans text-xs leading-5 text-fg-muted">
            {t("settings.trustWarning")}
          </p>

          <div className="flex flex-col gap-1.5">
            {permissions.length === 0 && settingGrants.length === 0 ? (
              <Caption className="text-fg-subtle">{t("settings.noPermissions")}</Caption>
            ) : (
              <>
                {permissions.map((permission) => (
                  <div key={permission} className="flex items-baseline gap-2">
                    <Badge className="shrink-0 text-[11px]">{t(permissionNameKey(permission) as never)}</Badge>
                    <span className="font-sans text-xs leading-5 text-fg-muted">
                      {t(permissionLabelKey(permission) as never)}
                    </span>
                  </div>
                ))}
                {settingGrants.map(({ operation, path }) => (
                  <div key={`${operation}:${path}`} className="flex items-baseline gap-2">
                    <Badge className="shrink-0 text-[11px]">
                      {t(`settings.settingsAccess.${operation}` as never)}
                    </Badge>
                    <span className="font-mono text-xs leading-5 text-fg-muted">
                      {path}
                    </span>
                  </div>
                ))}
                {permissions.includes("service:network") && (
                  <div className="flex min-w-0 flex-col gap-1">
                    <Caption>{t("settings.networkAccess.title")}</Caption>
                    {networkOrigins.length === 0 ? (
                      <Caption className="text-fg-muted">{t("settings.networkAccess.none")}</Caption>
                    ) : networkOrigins.map(origin => (
                      <Caption key={origin} className="break-all text-fg-muted">
                        {origin === "*" ? t("settings.networkAccess.all") : origin}
                      </Caption>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <PluginBookAccessSelector
            value={grant}
            books={books}
            disabled={busy}
            onChange={(next) => {
              setGrant(next);
              setInvalid(false);
            }}
          />
          {invalid && (
            <InlineError compact>{t("settings.bookAccess.invalidBook")}</InlineError>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>
              {t("settings.installConfirm.cancel")}
            </Button>
            <Button size="sm" disabled={busy || !valid} aria-busy={busy} onClick={confirm}>
              {busy ? t("settings.installConfirm.installing") : t("settings.installConfirm.confirm")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
