import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  readerOverridesAtom,
  readerBookLanguagesAtom,
  readerPreferencesAtom,
  resolvedAppThemeStateAtom,
} from "../../../state/ui";
import {
  readerPreferencesForLanguage,
  updateReaderLanguagePreferences,
  type ReaderSettings,
  type ReaderSettingsPreferences,
} from "../../settings/lib/reader-settings";
import type { ReaderAppearanceScope } from "../../settings/lib/reader-overrides";
import { projectReaderAppearance, type ReaderAppearanceProjection } from "../lib/reader-appearance-source";

export type { ReaderAppearanceScope };

type UseReaderAppearanceResult = {
  /** Global fonts are shared by book language; other global settings by all books. */
  scope: ReaderAppearanceScope;
  /** The preferences the controls bind to — global prefs or the book override. */
  prefs: ReaderSettingsPreferences;
  /** Render-ready settings for this book, with `auto` page color resolved. */
  effective: ReaderSettings;
  setScope: (scope: ReaderAppearanceScope) => void;
  updatePrefs: (prefs: ReaderSettingsPreferences) => void;
};

/**
 * Resolves the appearance a given book reads with and routes edits to the right
 * place. Global font choices follow the book's language automatically, while
 * other controls stay shared. Book scope reads/writes the book's own snapshot.
 * Both the reader surface and the appearance popover call this with the same
 * book id, so they stay in sync through the shared atoms.
 */
export function useReaderAppearance(bookId: string): UseReaderAppearanceResult {
  const [globalPrefs, setGlobalPrefs] = useAtom(readerPreferencesAtom);
  const [overrides, setOverrides] = useAtom(readerOverridesAtom);
  const appTheme = useAtomValue(resolvedAppThemeStateAtom);
  const languages = useAtomValue(readerBookLanguagesAtom);
  const language = languages[bookId];
  const languagePrefs = useMemo(() => readerPreferencesForLanguage(globalPrefs, language), [globalPrefs, language]);
  const committed = useRef<ReaderAppearanceProjection | undefined>(undefined);

  const override = overrides[bookId];
  const scope: ReaderAppearanceScope = override?.scope === "book" ? "book" : "global";
  const prefs = scope === "book" && override ? override.settings : languagePrefs;
  // Keep a stable reference so consumers that key effects on the settings object
  // (e.g. the reader re-injecting CSS) only react to genuine changes, not to
  // every render — a fresh object each render would reset reader scroll position.
  const projection = useMemo(
    () => projectReaderAppearance({ bookId, scope, prefs, source: scope === "book" ? overrides : globalPrefs,
      language, languageSource: languages, scopeSource: overrides, theme: appTheme }, committed.current),
    [bookId, scope, prefs, overrides, globalPrefs, appTheme, language, languages],
  );
  useLayoutEffect(() => { committed.current = projection; }, [projection]);
  const effective = projection.value;

  const setScope = useCallback(
    (next: ReaderAppearanceScope) => {
      const existing = overrides[bookId];
      if (next === "book") {
        // Seed from the stored snapshot, or this language's current global settings.
        const settings = existing?.settings ?? languagePrefs;
        setOverrides({ ...overrides, [bookId]: { scope: "book", settings } });
        return;
      }
      // Back to global — keep the snapshot so the book can be re-customized later.
      if (!existing) return;
      setOverrides({ ...overrides, [bookId]: { ...existing, scope: "global" } });
    },
    [bookId, languagePrefs, overrides, setOverrides],
  );

  const updatePrefs = useCallback(
    (next: ReaderSettingsPreferences) => {
      if (scope === "book") {
        setOverrides({ ...overrides, [bookId]: { scope: "book", settings: next } });
        return;
      }
      setGlobalPrefs(updateReaderLanguagePreferences(globalPrefs, language, next));
    },
    [bookId, overrides, scope, globalPrefs, language, setGlobalPrefs, setOverrides],
  );

  return { scope, prefs, effective, setScope, updatePrefs };
}
