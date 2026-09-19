import { Body, Button, Heading, InlineError } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

type ReaderFailureViewProps = {
  title: string;
  bookTitle?: string;
  message: string;
  action?: { label: string; onClick: () => void };
  onBack?: () => void;
};

/** Reader recovery is app UI: pair the app's foreground tokens with its opaque
 * canvas, never with the independently configured book-page background. The
 * existing feedback and button components own contrast, focus and semantics. */
export function ReaderFailureView({ title, bookTitle, message, action, onBack }: ReaderFailureViewProps) {
  const { t } = useTranslation("reader");
  return (
    <section
      aria-label={title}
      className="absolute inset-0 z-20 grid place-items-center overflow-auto bg-paper px-6 py-16 text-fg"
    >
      <div className="w-full max-w-lg space-y-5">
        <div className="space-y-2">
          <Heading className="font-serif font-normal leading-display">{title}</Heading>
          {bookTitle && <Body className="break-words text-sm leading-6 text-fg-muted">{bookTitle}</Body>}
        </div>
        <InlineError compact className="flex text-sm leading-6">
          {message}
        </InlineError>
        <div className="flex flex-wrap items-center gap-3">
          {action && <Button autoFocus onClick={action.onClick}>{action.label}</Button>}
          {onBack && (
            <Button autoFocus={!action} variant={action ? "outline" : "solid"} onClick={onBack}>
              {t("backToLibrary")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
