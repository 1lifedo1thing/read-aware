import { Caption, ChoiceGroup, InlineError, Select } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { PluginBookAccess } from "../lib/plugin-types";

export type PluginBookOption = {
  id: string;
  title: string;
};

type PluginBookAccessSelectorProps = {
  value: PluginBookAccess;
  books: readonly PluginBookOption[];
  onChange: (value: PluginBookAccess) => void;
  disabled?: boolean;
};

const ACCESS_MODES: PluginBookAccess["mode"][] = ["all", "current", "book"];

/**
 * Returns only the books that can safely become a host object grant. The
 * picker never emits an empty or unknown book id, even if a stale caller
 * supplied one or the library changed while the dialog was open.
 */
export function availablePluginBooks(
  books: readonly PluginBookOption[],
): PluginBookOption[] {
  const seen = new Set<string>();
  return books.filter((book) => {
    const id = book.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((book) => ({ id: book.id.trim(), title: book.title || book.id.trim() }));
}

/** A grant is valid only when a book-scoped grant names a current library row. */
export function isValidPluginBookAccess(
  value: PluginBookAccess,
  books: readonly PluginBookOption[],
): boolean {
  if (value.mode === "all" || value.mode === "current") return true;
  const id = value.bookId.trim();
  return id.length > 0 && availablePluginBooks(books).some((book) => book.id === id);
}

export function PluginBookAccessSelector({
  value,
  books,
  onChange,
  disabled = false,
}: PluginBookAccessSelectorProps) {
  const { t } = useTranslation("plugins");
  const availableBooks = availablePluginBooks(books);
  const options = ACCESS_MODES
    .filter((mode) => mode !== "book" || availableBooks.length > 0)
    .map((mode) => ({
      value: mode,
      label: t(`settings.bookAccess.${mode}` as never),
    }));
  const selectedBookId = value.mode === "book" ? value.bookId : "";
  const selectedBookIsValid = value.mode !== "book"
    || availableBooks.some((book) => book.id === value.bookId.trim());

  const selectMode = (mode: PluginBookAccess["mode"]) => {
    if (mode === "all" || mode === "current") {
      onChange({ mode });
      return;
    }
    const firstBook = availableBooks[0];
    if (firstBook) onChange({ mode: "book", bookId: firstBook.id });
  };

  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup
        label={t("settings.bookAccess.label")}
        value={value.mode}
        options={options}
        disabled={disabled}
        onChange={selectMode}
      />

      {value.mode === "book" && (
        availableBooks.length > 0 ? (
          <Select
            label={t("settings.bookAccess.bookLabel")}
            ariaLabel={t("settings.bookAccess.bookLabel")}
            variant="outlined"
            value={selectedBookId}
            disabled={disabled}
            options={availableBooks.map((book) => ({ value: book.id, label: book.title }))}
            placeholder={t("settings.bookAccess.bookPlaceholder")}
            error={!selectedBookIsValid ? t("settings.bookAccess.invalidBook") : undefined}
            onChange={(bookId) => {
              const selected = availableBooks.find((book) => book.id === bookId);
              if (selected) onChange({ mode: "book", bookId: selected.id });
            }}
          />
        ) : (
          <InlineError compact>{t("settings.bookAccess.noBooks")}</InlineError>
        )
      )}

      <Caption className="leading-5 text-fg-muted">
        {t(`settings.bookAccess.${value.mode}Description` as never)}
      </Caption>
      {value.mode !== "all" && (
        <Caption className="leading-5 text-fg-muted">
          {t("settings.bookAccess.restrictedNotice")}
        </Caption>
      )}
    </div>
  );
}
