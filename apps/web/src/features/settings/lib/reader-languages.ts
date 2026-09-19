import { localKV } from "../../../platform/local-store";
import type { DomainActor } from "../../../platform/domain-actor";
import { normalizeBookLanguage } from "../../reader/lib/book-language";

/** Derived, device-local language hints; rechecked against the source on each open. */
export const READER_LANGUAGES_KEY = "read-aware-reader-languages";
export type ReaderBookLanguages = Record<string, string>;

export function getReaderBookLanguages(): ReaderBookLanguages {
  try {
    const parsed: unknown = JSON.parse(localKV.getItem(READER_LANGUAGES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, language]) => [id, normalizeBookLanguage(language) ?? "und"]));
  } catch {
    return {}; // This derived cache can always be rebuilt from the book file.
  }
}

export function rememberReaderBookLanguage(bookId: string, language: string, origin: DomainActor): void {
  const languages = getReaderBookLanguages();
  const normalized = normalizeBookLanguage(language) ?? "und";
  if (languages[bookId] === normalized) return;
  localKV.setItem(READER_LANGUAGES_KEY, JSON.stringify({ ...languages, [bookId]: normalized }), "local", origin);
}
