/**
 * Automatic plugin updates from the marketplace. Once a day — and right away
 * after the app itself updated or while an installed plugin is too old to run —
 * fetch the registry and update every plugin installed from the marketplace
 * with a newer release:
 *
 * - provenance comes first: a plugin installed from a local folder or zip is
 *   never replaced by a listing that shares its id, and one installed before
 *   provenance was recorded is only announced, never replaced silently;
 * - a release this app cannot run is skipped (the installed one keeps working);
 * - a release asking for more authority than the user approved (permissions,
 *   settings access, network origins) is announced once per version and waits
 *   for consent in Settings → Plugins;
 * - anything else applies silently with the user's existing grants, without
 *   changing whether the plugin is enabled.
 */
import { getVersion } from "@tauri-apps/api/app";
import { ERR_PLUGIN_UPDATE_REQUIRED, errorCode } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { i18n } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { pluginUpdateWidensAuthority } from "../lib/plugin-authority";
import { showPluginToast } from "../lib/plugin-toast";
import type { InstalledPlugin } from "../lib/plugin-types";
import { installedPluginsAtom } from "../state/plugin-store";
import { fetchMarketplaceRegistry, prepareMarketplaceInstall, type MarketplaceEntry } from "./marketplace";
import { updatePluginFiles } from "./plugin-host";
import { assertPluginManifestCanActivate } from "./plugin-manifest-readiness";

const CHECK_KEY = "read-aware-plugin-update-check";
const CHECK_INTERVAL_MS = 20 * 60 * 60 * 1000;
// A failed fetch (offline, registry blocked) cools the check down for a while:
// restart-heavy sessions would otherwise re-pay the mirror timeouts on every
// launch. Short enough that connectivity coming back is noticed the same day.
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

type CheckState = {
  at: number;
  /** Last attempt that failed to fetch the registry; 0 after a success. */
  failedAt: number;
  /** The app version of the last completed check; a different one checks at once. */
  appVersion: string | null;
  /** plugin id → last release announced as waiting for consent. */
  notified: Record<string, string>;
};

function readState(): CheckState {
  try {
    const raw = localKV.getItem(CHECK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<CheckState>) : null;
    return {
      at: typeof parsed?.at === "number" ? parsed.at : 0,
      failedAt: typeof parsed?.failedAt === "number" ? parsed.failedAt : 0,
      appVersion: typeof parsed?.appVersion === "string" ? parsed.appVersion : null,
      notified: parsed?.notified && typeof parsed.notified === "object" ? parsed.notified : {},
    };
  } catch {
    return { at: 0, failedAt: 0, appVersion: null, notified: {} };
  }
}

/** "1.2.0" > "1.1.9" — numeric per segment, missing segments are zero. */
export function versionNewer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return false;
}

const log = createLogger("plugins");

type UpdateOutcome = "updated" | "needs-consent" | "unsupported" | "failed";

async function updateOne(plugin: InstalledPlugin, entry: MarketplaceEntry, appVersion: string): Promise<UpdateOutcome> {
  try {
    const release = await prepareMarketplaceInstall(entry);
    try {
      assertPluginManifestCanActivate(release.manifest, { appVersion, builtin: false });
    } catch (error) {
      log.info(`marketplace release ${entry.version} of "${entry.id}" cannot run on this app yet`, error);
      return "unsupported";
    }
    if (pluginUpdateWidensAuthority(plugin.manifest, release.manifest)) return "needs-consent";
    await updatePluginFiles(plugin.manifest.id, await release.download(), "system");
    return "updated";
  } catch (error) {
    log.warn(`automatic update of "${entry.id}" to ${entry.version} failed`, error);
    return "failed";
  }
}

/** Runs after plugin initialization; a no-op until the interval or a trigger says otherwise. */
export async function updatePluginsFromMarketplace(): Promise<void> {
  // Installing needs the desktop shell; a plain browser has no plugins to update.
  if (!isTauri()) return;
  const state = readState();
  const now = Date.now();
  const appVersion = await getVersion();
  const installed = getDefaultStore().get(installedPluginsAtom);
  const outdated = installed.some(
    (plugin) =>
      !plugin.builtin && plugin.installSource !== "local" && errorCode(plugin.error) === ERR_PLUGIN_UPDATE_REQUIRED,
  );
  const due = now - state.at >= CHECK_INTERVAL_MS || state.appVersion !== appVersion || outdated;
  if (!due || now - state.failedAt < FAILURE_COOLDOWN_MS) return;

  let entries;
  try {
    entries = await fetchMarketplaceRegistry();
  } catch (error) {
    // Offline or registry hiccup — cool down, try again later, never nag the
    // user. The warn is what separates "quiet" from "permanently broken":
    // a mirror that 404s forever shows up here on every expired cooldown.
    log.warn("plugin update check failed; cooling down", error);
    localKV.setItem(CHECK_KEY, JSON.stringify({ ...state, failedAt: now } satisfies CheckState));
    return;
  }

  const t = i18n.getFixedT(null, "plugins");
  const notified = { ...state.notified };
  for (const entry of entries) {
    const plugin = getDefaultStore()
      .get(installedPluginsAtom)
      .find((candidate) => candidate.manifest.id === entry.id);
    if (!plugin || plugin.builtin || plugin.installSource === "local") continue;
    if (!versionNewer(entry.version, plugin.manifest.version)) continue;
    const announce = (key: "settings.updateAvailableToast" | "settings.updateNeedsConsentToast") => {
      if (notified[entry.id] === entry.version) return;
      notified[entry.id] = entry.version;
      showPluginToast(String(t(key, { name: entry.name, version: entry.version })));
    };
    if (plugin.installSource !== "marketplace") {
      // Unknown provenance: the listing may not be this plugin's publisher.
      announce("settings.updateAvailableToast");
      continue;
    }
    const outcome = await updateOne(plugin, entry, appVersion);
    if (outcome === "updated") {
      showPluginToast(String(t("settings.autoUpdatedToast", { name: plugin.manifest.name, version: entry.version })));
    } else if (outcome === "needs-consent") {
      announce("settings.updateNeedsConsentToast");
    }
  }

  localKV.setItem(
    CHECK_KEY,
    JSON.stringify({ at: Date.now(), failedAt: 0, appVersion, notified } satisfies CheckState),
  );
}
