import { AppError, normalizePluginContributionQuery, type PluginContributionEntry, type PluginContributionPage, type PluginContributionQuery } from "@read-aware/core";
import { inspectContributions, subscribeContributions } from "../features/plugins/state/contribution-registry";
import { listSyncTransports, onSyncTransportsChanged } from "../platform/sync/transport-registry";
import { createLogger } from "../platform/logger";
import { observeSnapshot } from "../domain/snapshot-observation";
import type { DomainActor } from "../platform/domain-actor";

const log = createLogger("plugin-contributions");
let observers = 0;

/** All registered extension points, not declarations or an execution grant.
 * The transport registry has a distinct session owner; merge its identities,
 * not its credential-bearing session objects, into the common directory. */
export function registeredPluginContributions(): PluginContributionEntry[] {
  return [...inspectContributions(), ...listSyncTransports().map(item => ({ point: "syncTransports" as const, pluginId: item.pluginId, key: item.ref }))];
}

export function pluginContributionPage(entries: readonly PluginContributionEntry[], query?: PluginContributionQuery): PluginContributionPage {
  const { point, pluginId, search, offset, limit } = normalizePluginContributionQuery(query);
  const matches = entries.filter(entry => (!point || entry.point === point) && (!pluginId || entry.pluginId === pluginId)
    && (!search || `${entry.point} ${entry.pluginId} ${entry.key}`.toLowerCase().includes(search)))
    .sort((a, b) => a.point.localeCompare(b.point) || a.pluginId.localeCompare(b.pluginId) || a.key.localeCompare(b.key));
  // Keep model/Worker payloads bounded without truncating identities.
  const contributions: PluginContributionEntry[] = [];
  let remaining = 16_000;
  for (const entry of matches.slice(offset, offset + limit)) {
    const copy = { point: entry.point, pluginId: entry.pluginId, key: entry.key };
    const size = JSON.stringify(copy).length + 1;
    if (size > remaining) {
      if (!contributions.length) throw new AppError("ui/unavailable", "Contribution identity exceeds the public page budget");
      break;
    }
    remaining -= size; contributions.push(copy);
  }
  const next = offset + contributions.length;
  return { contributions, total: matches.length, offset, nextOffset: next < matches.length ? next : null };
}

export const pluginContributions = {
  list: async (query?: PluginContributionQuery) => pluginContributionPage(registeredPluginContributions(), query),
  observe(query: PluginContributionQuery, handler: (page: PluginContributionPage, source?: object) => unknown, origin?: DomainActor): () => void {
    const accepted = normalizePluginContributionQuery(query);
    if (observers >= 64) throw new AppError("ui/observer-limit", "Too many contribution observers");
    let stopped = false;
    // Reserve before the initial callback, which may synchronously subscribe.
    observers++;
    let off: () => void;
    try { off = observeSnapshot(() => pluginContributionPage(registeredPluginContributions(), accepted), notify => {
      const registry = subscribeContributions(notify), transport = onSyncTransportsChanged(notify);
      return () => { registry(); transport(); };
    }, handler, error => log.warn("Contribution directory observer failed", error), origin); }
    catch (error) { observers--; throw error; }
    return () => { if (!stopped) { stopped = true; observers--; off(); } };
  },
};
