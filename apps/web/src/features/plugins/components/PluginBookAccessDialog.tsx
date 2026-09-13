import { useEffect, useRef, useState } from "react";
import { Button, Caption, Dialog, InlineError } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { PluginBookAccess } from "../lib/plugin-types";
import {
  isValidPluginBookAccess,
  type PluginBookOption,
  PluginBookAccessSelector,
} from "./PluginBookAccessSelector";

type PluginBookAccessSource = "legacy-domain" | "user";

type PluginBookAccessDialogProps = {
  open: boolean;
  pluginName: string;
  grant: PluginBookAccess;
  source: PluginBookAccessSource;
  books: readonly PluginBookOption[];
  onClose: () => void;
  onSubmit: (grant: PluginBookAccess) => Promise<void>;
};

/**
 * Settings editor for an installed plugin's object grant. The draft lives in
 * this dialog until the user submits; cancelling therefore cannot alter the
 * host's active authorization.
 */
export function PluginBookAccessDialog({
  open,
  pluginName,
  grant,
  source,
  books,
  onClose,
  onSubmit,
}: PluginBookAccessDialogProps) {
  const { t } = useTranslation("plugins");
  const [draft, setDraft] = useState<PluginBookAccess>(grant);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(grant);
      setBusy(false);
      setFailed(false);
    }
    wasOpen.current = open;
  }, [open, grant]);

  const valid = isValidPluginBookAccess(draft, books);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(draft);
      onClose();
    } catch {
      // The host owns the raw failure and logging. Keep the dialog and draft
      // visible with a localized, actionable surface.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("settings.bookAccess.editTitle", { name: pluginName })}
      className="w-full max-w-md"
    >
      {open && (
        <div className="flex flex-col gap-4">
          <Caption className="leading-5 text-fg-muted">
            {t("settings.bookAccess.editDescription")}
          </Caption>
          {source === "legacy-domain" && (
            <Caption className="leading-5 text-fg-muted">
              {t("settings.bookAccess.legacy")}
            </Caption>
          )}
          <PluginBookAccessSelector
            value={draft}
            books={books}
            disabled={busy}
            onChange={setDraft}
          />
          {failed && (
            <InlineError>{t("settings.bookAccess.updateFailed")}</InlineError>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
              {t("settings.bookAccess.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || !valid}
              aria-busy={busy}
              onClick={() => void submit()}
            >
              {busy ? t("settings.bookAccess.saving") : t("settings.bookAccess.save")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
