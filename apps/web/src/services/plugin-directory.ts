import { observeSnapshot } from "../domain/snapshot-observation";
import type { DomainActor } from "../platform/domain-actor";
import { AppError, normalizePluginDirectoryQuery, type PluginDirectoryEntry, type PluginDirectoryPage, type PluginDirectoryQuery } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { installedPluginsAtom } from "../features/plugins/state/plugin-store";
import type { InstalledPlugin } from "../features/plugins/lib/plugin-types";
import { createLogger } from "../platform/logger";
import { pluginContributions } from "./plugin-contributions";

const log = createLogger("plugin-directory");
let observers = 0;
export function pluginDirectoryPage(installed: readonly InstalledPlugin[], query?: PluginDirectoryQuery): PluginDirectoryPage {
  const { search, offset, limit } = normalizePluginDirectoryQuery(query);
  const plugins: PluginDirectoryEntry[] = installed.map(({ manifest, enabled, builtin, error }) => ({
    id: manifest.id, name: typeof manifest.name === "string" ? manifest.name : manifest.id,
    version: manifest.version, builtin: !!builtin, enabled, activationFailed: !!error,
  })).filter(plugin => !search || `${plugin.id} ${plugin.name}`.toLowerCase().includes(search)).sort((a, b) => a.id.localeCompare(b.id));
  return { plugins: plugins.slice(offset, offset + limit), total: plugins.length, offset,
    nextOffset: offset + limit < plugins.length ? offset + limit : null };
}
export const pluginDirectory = {
  contributions: pluginContributions.list,
  observeContributions: pluginContributions.observe,
  list: async (query?: PluginDirectoryQuery) => pluginDirectoryPage(getDefaultStore().get(installedPluginsAtom), query),
  observe: (query: PluginDirectoryQuery, handler: (page: PluginDirectoryPage, source?: object) => unknown, origin?: DomainActor) => {
    const accepted = normalizePluginDirectoryQuery(query), store = getDefaultStore();
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected directory observer");
    if (observers >= 64) throw new AppError("ui/observer-limit", "Too many directory observers");
    observers++;
    let off: () => void, stopped = false;
    try {
      off = observeSnapshot(() => pluginDirectoryPage(store.get(installedPluginsAtom), accepted),
        notify => store.sub(installedPluginsAtom, () => notify(store.get(installedPluginsAtom))),
        handler, error => log.warn("Plugin directory observer failed", error), origin);
    } catch (error) { observers--; throw error; }
    return () => { if (stopped) return; stopped = true; observers--; off(); };
  },
};
