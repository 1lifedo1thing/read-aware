import { isDevBundle } from "../app-identity";

// Separate URL selection from scheduler startup so it can be checked against
// real Vite output without starting sync or loading device data.
export const DEFAULT_RELAY_URL = "https://relay.readaware.app";

/** Where a dev-identified bundle points when nothing else says otherwise. */
const DEV_BUNDLE_RELAY_URL = "http://localhost:8787";

/**
 * Dev-session default when no KV override exists: `VITE_READAWARE_RELAY_URL`
 * baked by the dev server. The KV override is DATA, so "Delete all data"
 * rightly wipes it — which used to silently re-point a dev install at
 * production mid-test. Env-var fallback survives any wipe, but is only used
 * by the dev server or a runtime-identified ReadAware Dev bundle.
 */
export function defaultRelayUrl(): string {
  // Bun can preload .env.development before Vite selects production mode,
  // especially through the Windows build scripts. The absence of an explicit
  // CI override does not mean this variable is absent from a release bundle.
  if (!import.meta.env.DEV && !isDevBundle()) return DEFAULT_RELAY_URL;

  const dev = import.meta.env.VITE_READAWARE_RELAY_URL as string | undefined;
  if (dev) {
    if (import.meta.env.DEV) {
      // On a phone, "localhost" is the phone — the URL needs the dev
      // machine's address instead. The Tauri CLI knows it exactly
      // (TAURI_DEV_HOST, baked in by vite.config), so prefer that ground
      // truth over any guessing.
      const devHost = import.meta.env.VITE_TAURI_DEV_HOST as string | undefined;
      if (devHost) return dev.replace("localhost", devHost);
      // No TAURI_DEV_HOST: fall back to the page's own hostname — the
      // frontend was served from the dev machine, so on a LAN-served device
      // that hostname reaches it. But NEVER substitute a `*.localhost` host:
      // that is Tauri's own proxy scheme (`tauri.localhost` on mobile dev
      // without TAURI_DEV_HOST), and its interceptor answers EVERY port with
      // the SPA itself — the relay would "reply" 200 index.html and every
      // sync call would fail with a misleading decode error. Keeping
      // "localhost" fails honestly (connection refused) instead.
      const pageHost = window.location.hostname;
      if (
        pageHost &&
        pageHost !== "localhost" &&
        pageHost !== "127.0.0.1" &&
        !pageHost.endsWith(".localhost")
      ) {
        return dev.replace("localhost", pageHost);
      }
    }
    // Bundled dev builds load from tauri://localhost — no page host to
    // follow, so the baked URL must already be the reachable address.
    return dev;
  }
  // The last fallback is gated on runtime identity: a dev-IDENTIFIED bundle
  // built in release mode (`tauri build --config tauri.dev.conf.json`) may see
  // no VITE_* defaults at all, and without this guard would silently point a
  // dev install at the production relay. Local relay or bust — an
  // unreachable local relay fails loudly instead of polluting production.
  if (isDevBundle()) return DEV_BUNDLE_RELAY_URL;
  return DEFAULT_RELAY_URL;
}
