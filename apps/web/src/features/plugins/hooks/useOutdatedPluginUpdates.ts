import { ERR_PLUGIN_UPDATE_REQUIRED, errorCode } from "@read-aware/core";
import type { InstalledPlugin } from "../lib/plugin-types";
import { versionNewer } from "../runtime/plugin-updates";
import { useMarketplaceInstall } from "./useMarketplaceInstall";
import { useMarketplaceRegistry } from "./useMarketplaceRegistry";

export type PluginUpdateOffer = { version: string; busy: boolean; onUpdate: () => void };

/**
 * Update offers for installed plugins that cannot run because they target
 * older host contracts. The registry is fetched only while such a plugin
 * exists; a plugin without a newer marketplace release gets no offer.
 */
export function useOutdatedPluginUpdates(
  installed: InstalledPlugin[],
  books: Array<{ id: string; title: string }>,
  { enabled = true } = {},
) {
  const outdated = installed.some(
    (plugin) =>
      !plugin.builtin && plugin.installSource !== "local" && errorCode(plugin.error) === ERR_PLUGIN_UPDATE_REQUIRED,
  );
  const { state } = useMarketplaceRegistry({ enabled: enabled && outdated });
  const { busyId, install } = useMarketplaceInstall(books);

  return (plugin: InstalledPlugin): PluginUpdateOffer | undefined => {
    // A local folder or zip is not the marketplace listing's plugin, even with the same id.
    if (plugin.builtin || plugin.installSource === "local" || state.status !== "ready") return undefined;
    const entry = state.entries.find(
      (candidate) => candidate.id === plugin.manifest.id && versionNewer(candidate.version, plugin.manifest.version),
    );
    if (!entry) return undefined;
    return { version: entry.version, busy: busyId === entry.id, onUpdate: () => void install(entry) };
  };
}
