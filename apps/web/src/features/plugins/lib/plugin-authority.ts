/**
 * Whether a plugin update asks for more than the user already approved.
 *
 * "Approved" is exactly what the install consent dialog discloses:
 * permissions, settings access paths and network origins. Book access is the
 * user's own grant and carries over unchanged. An update within that
 * authority may apply without asking again; anything new needs consent.
 */
import { matchesSettingsPath, settingsAccessPatterns } from "../../../domain/settings/domain";
import type { PluginManifest } from "./plugin-types";

const SETTINGS_OPERATIONS = ["discover", "read", "write"] as const;

/** A declared settings pattern is covered when every path it matches was already granted. */
function settingsPatternCovered(granted: readonly string[], pattern: string): boolean {
  if (!pattern.endsWith(".*")) return granted.some((existing) => matchesSettingsPath(existing, pattern));
  const subtree = pattern.slice(0, -1);
  return granted.some(
    (existing) => existing === "*" || (existing.endsWith(".*") && subtree.startsWith(existing.slice(0, -1))),
  );
}

export function pluginUpdateWidensAuthority(current: PluginManifest, next: PluginManifest): boolean {
  const permissions = new Set(current.permissions ?? []);
  if ((next.permissions ?? []).some((permission) => !permissions.has(permission))) return true;

  const currentSettings = current.settingsAccess ?? {};
  for (const operation of SETTINGS_OPERATIONS) {
    const granted = settingsAccessPatterns(currentSettings, operation);
    if ((next.settingsAccess?.[operation] ?? []).some((pattern) => !settingsPatternCovered(granted, pattern))) {
      return true;
    }
  }

  const origins = current.networkAccess?.origins ?? [];
  if (origins.includes("*")) return false;
  return (next.networkAccess?.origins ?? []).some((origin) => !origins.includes(origin));
}
