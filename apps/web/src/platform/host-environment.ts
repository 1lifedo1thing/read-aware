import { DEFAULT_LOCALE, i18n, localeActor } from "../i18n";
import { isTauri, isMacOS, isWindows, isLinux } from "./environment";
import { createLogger } from "./logger";
import { HostEnvironmentStore } from "./host-environment-store";

import { actorFromEvent, mergeEventCauses, stampEventCause } from "./domain-actor";

const log = createLogger("host-environment");
export const hostEnvironment = new HostEnvironmentStore({
  read: () => {
    let timeZone: string | null = null;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
    catch { /* Missing timezone data is represented as unknown, not guessed. */ }
    return {
      runtime: isTauri() ? "desktop" : "preview",
      platform: isMacOS() ? "macos" : isWindows() ? "windows" : isLinux() ? "linux" : "unknown",
      locale: i18n.language || DEFAULT_LOCALE,
      timeZone,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      networkHint: typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? "unknown" : navigator.onLine ? "online" : "offline",
    };
  },
  source: (previous, next) => {
    const sources: object[] = [];
    if (!previous || previous.locale !== next.locale) sources.push(stampEventCause({}, localeActor()));
    if (previous && Object.entries(next).some(([key, value]) => key !== "locale" && previous[key as keyof typeof next] !== value)) sources.push(stampEventCause({}));
    return actorFromEvent(mergeEventCauses(sources, {}));
  },
  watch: changed => {
    i18n.on("languageChanged", changed);
    const events = ["online", "offline", "focus", "pageshow"] as const;
    if (typeof window !== "undefined") for (const event of events) window.addEventListener(event, changed);
    // Timezone/DST changes have no portable WebView event. Queries also refresh.
    const timer = setInterval(changed, 30_000);
    return () => {
      clearInterval(timer);
      i18n.off("languageChanged", changed);
      if (typeof window !== "undefined") for (const event of events) window.removeEventListener(event, changed);
    };
  },
  report: error => log.warn("environment observer failed", error),
});
