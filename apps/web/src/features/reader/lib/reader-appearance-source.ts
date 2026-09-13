import { actorFromEvent, eventCause, mergeEventCauses, stampEventCause } from "../../../platform/domain-actor";
import { toEffectiveReaderSettings, type ReaderSettings, type ReaderSettingsPreferences } from "../../settings/lib/reader-settings";

export type ReaderAppearanceInput = {
  bookId: string;
  scope: "global" | "book";
  prefs: ReaderSettingsPreferences;
  source: object;
  scopeSource: object;
  theme: { value: "light" | "dark" };
};
export type ReaderAppearanceProjection = { input: ReaderAppearanceInput; value: ReaderSettings };

/** Only inputs that changed the rendered settings contribute a cause. Inactive
 * book overrides and old auto-theme roots must not revive a consumed reaction. */
export function projectReaderAppearance(input: ReaderAppearanceInput, previous?: ReaderAppearanceProjection): ReaderAppearanceProjection {
  const value = toEffectiveReaderSettings(input.prefs, input.theme.value);
  if (previous?.input.bookId === input.bookId && JSON.stringify(value) === JSON.stringify(previous.value)) return { input, value: previous.value };
  const sources: object[] = [];
  if (!previous || previous.input.bookId !== input.bookId) sources.push(input.source);
  else {
    if (previous.input.scope !== input.scope) sources.push(input.scopeSource);
    else if (JSON.stringify(previous.input.prefs) !== JSON.stringify(input.prefs)) sources.push(input.source);
    if (input.prefs.theme === "auto" && previous.input.theme.value !== input.theme.value) sources.push(input.theme);
  }
  const tracked = sources.map(source => eventCause(source) ? source : stampEventCause({}));
  return { input, value: stampEventCause(value, actorFromEvent(mergeEventCauses(tracked, {}))) };
}
