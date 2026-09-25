import { Button, Caption, InlineError, Select, Spinner, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";

type FontFieldProps = FontChoicesOptions & { className?: string };

/**
 * Body-font picker as a dropdown (see useFontChoices for what it offers).
 * Flip the "Custom" switch and the dropdown instead enumerates every font
 * installed on this device. Shared by the Reading panel, the in-reader
 * popover, and the content typography controls.
 */
export function FontField({ className, ...options }: FontFieldProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  const { custom, setCustom } = fonts;

  return (
    <div className={cn("relative", className)}>
      <label className="absolute right-0 top-0 z-[1] inline-flex cursor-pointer items-center gap-2">
        <span className="font-sans text-[13px] text-fg-muted">{t("font.custom")}</span>
        <Toggle
          aria-label={t("font.customAria")}
          checked={custom}
          onChange={setCustom}
        />
      </label>
      <Select
        label={t("font.label")}
        value={fonts.selectValue}
        options={fonts.options}
        placeholder={custom ? t("font.placeholderCustom") : t("font.placeholderCurated")}
        onChange={fonts.choose}
      />
      <FontChoiceStatus fonts={fonts} />
    </div>
  );
}

/** The download and device-list states under a font picker. */
export function FontChoiceStatus({ fonts }: { fonts: ReturnType<typeof useFontChoices> }) {
  const { t } = useTranslation("settings");
  const { custom, systemLoading, systemFailure, retrySystemFonts, fontFace } = fonts;
  return (
    <>
      {custom && systemLoading && <Spinner size="sm" className="mt-1.5" />}
      {custom && systemFailure && (
        <InlineError compact onRetry={systemFailure.retryable ? retrySystemFonts : undefined} retryLabel={t("font.retry")}>
          {systemFailure.body}
        </InlineError>
      )}
      {/* Download feedback for curated fonts — fetched from a CDN on first use,
          which can be slow or unreachable; silence here read as a broken picker. */}
      {fontFace.status === "loading" && (
        <div className="mt-1.5 flex items-center gap-2 text-fg-muted">
          <Spinner size="sm" className="h-3 w-3" />
          <Caption>
            {t("font.downloading", { percent: Math.round(fontFace.progress * 100) })}
          </Caption>
        </div>
      )}
      {fontFace.status === "error" && (
        <div className="mt-1.5 flex items-center gap-2">
          <Caption className="text-red-800">{t("font.downloadFailed")}</Caption>
          <Button size="sm" variant="link" onClick={fontFace.retry}>
            {t("font.retry")}
          </Button>
        </div>
      )}
    </>
  );
}
