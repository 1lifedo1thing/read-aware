/**
 * i18n entry point. Owns i18next init + the React binding, and re-exports the
 * config and formatting layers so features import everything from
 * `@/i18n` (`../i18n`):
 *
 *   import { useTranslation, formatDate, setLocale, LOCALES } from "../i18n";
 *
 * Locale catalogs are lazy per-locale-per-namespace chunks (Vite splits the
 * templated dynamic import below), so only the active locale ever ships.
 */
import { initReactI18next, useTranslation } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { i18n } from "./instance";
import { actorFromEvent, causalActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import {
  DEFAULT_LOCALE,
  LOCALES,
  NAMESPACES,
  type AppLocale,
} from "./config";

function syncDocumentLocale(locale: AppLocale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

let initPromise: Promise<typeof i18n> | null = null;

/**
 * Initialize i18next for `locale` and load that locale's namespaces. Idempotent
 * — the first call wins, later calls return the same promise. Must resolve
 * before the app renders translated UI.
 */
export function initI18n(locale: AppLocale): Promise<typeof i18n> {
  if (initPromise) return initPromise;
  initPromise = i18n
    .use(
      resourcesToBackend(
        (language: string, namespace: string) =>
          import(`./locales/${language}/${namespace}.json`),
      ),
    )
    .use(initReactI18next)
    .init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: LOCALES as unknown as string[],
      ns: NAMESPACES as unknown as string[],
      defaultNS: "common",
      interpolation: { escapeValue: false },
      returnNull: false,
    })
    .then(() => {
      syncDocumentLocale(locale);
      return i18n;
    });
  return initPromise;
}

let localeSource = stampEventCause({ locale: i18n.language });
let localeRequest: { locale: AppLocale; origin: DomainActor } | undefined;
let localeTail: Promise<unknown> = Promise.resolve();
i18n.on("languageChanged", locale => {
  localeSource = stampEventCause({ locale }, localeRequest?.locale === locale ? localeRequest.origin : "system");
});

/** Host-private source of the currently applied locale, including lazy reads. */
export function localeActor(): DomainActor {
  return localeSource.locale === i18n.language ? actorFromEvent(localeSource) : causalActor("system");
}

/** Serialize lazy catalog loads so each applied language retains its requester. */
export function setLocale(locale: AppLocale, origin: DomainActor = "user"): Promise<void> {
  const request = { locale, origin: causalActor(origin) };
  const pending = localeTail.then(async () => {
    if (i18n.language === locale) return;
    localeRequest = request;
    try { await i18n.changeLanguage(locale); syncDocumentLocale(locale); }
    finally { localeRequest = undefined; }
  });
  localeTail = pending.catch(() => {});
  return pending;
}

/** Subscribe to the active locale; re-renders the caller on a language switch. */
export function useLocale(): AppLocale {
  const { i18n: instance } = useTranslation();
  return (instance.language as AppLocale) || DEFAULT_LOCALE;
}

export { i18n };
export { useTranslation, Trans } from "react-i18next";
export * from "./config";
export * from "./describe-error";
export * from "./format";
