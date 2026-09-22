/**
 * Base URL of the landing site (readaware.app) for links the app opens in the
 * system browser. Like the relay URL, development overrides require the dev
 * server or a ReadAware Dev identity: Bun can preload .env.development even
 * when Vite is building for production.
 */
import { isDevBundle } from "./app-identity";

export function siteBaseUrl(): string {
  if (!import.meta.env.DEV && !isDevBundle()) return "https://readaware.app";
  const dev = import.meta.env.VITE_READAWARE_SITE_URL as string | undefined;
  return dev || "https://readaware.app";
}

/** Public project destinations shared by the update notice and About. */
export const PROJECT_REPOSITORY_URL = "https://github.com/ahpxex/read-aware";
export const PROJECT_DISCORD_URL = "https://discord.gg/whDrKXwHWU";
export const PROJECT_AUTHOR_URL = "https://ahpx.me";
