import {
  AppError,
  CONTRIBUTION_CATALOG,
  DECLARATIVE_SCHEMA_CATALOG,
  DOMAIN_CATALOG,
  ERR_PLUGIN_APP_UPDATE_REQUIRED,
  ERR_PLUGIN_INVALID_PACKAGE,
  ERR_PLUGIN_UPDATE_REQUIRED,
  HOST_SERVICE_CATALOG,
  canUseContribution,
  canUseHostService,
  domainGrantsFromPermissions,
} from "@read-aware/core";
import { gtr, satisfies } from "semver";
import type { PluginCapabilityView, PluginManifest } from "../lib/plugin-types";

export function resolvePluginCapabilities(manifest: PluginManifest): PluginCapabilityView {
  const permissions = new Set(manifest.permissions ?? []);
  const grants = domainGrantsFromPermissions(manifest.permissions ?? []);
  const domains: PluginCapabilityView["domains"] = {
    settings: DOMAIN_CATALOG.settings.version,
  };
  for (const id of Object.keys(grants) as Array<keyof typeof DOMAIN_CATALOG>) {
    domains[id] = DOMAIN_CATALOG[id].version;
  }

  const contributions: PluginCapabilityView["contributions"] = {};
  for (const id of Object.keys(CONTRIBUTION_CATALOG) as Array<keyof typeof CONTRIBUTION_CATALOG>) {
    if (canUseContribution(id, permissions)) {
      contributions[id] = CONTRIBUTION_CATALOG[id].version;
    }
  }

  const services: PluginCapabilityView["services"] = {};
  for (const id of Object.keys(HOST_SERVICE_CATALOG) as Array<keyof typeof HOST_SERVICE_CATALOG>) {
    if (canUseHostService(id, permissions)) {
      services[id] = HOST_SERVICE_CATALOG[id].version;
    }
  }

  return {
    domains,
    contributions,
    services,
    schemas: {
      views: DECLARATIVE_SCHEMA_CATALOG.views.version,
      settings: DECLARATIVE_SCHEMA_CATALOG.settings.version,
      ...(permissions.has("ui:themes") ? { themes: DECLARATIVE_SCHEMA_CATALOG.themes.version } : {}),
    },
  };
}

const HOST_CATALOGS: Record<keyof PluginCapabilityView, Record<string, unknown>> = {
  domains: DOMAIN_CATALOG,
  contributions: CONTRIBUTION_CATALOG,
  services: HOST_SERVICE_CATALOG,
  schemas: DECLARATIVE_SCHEMA_CATALOG,
};

/**
 * Throws a coded error naming who must move: a requirement the host has
 * outgrown needs a plugin update; one the host does not offer yet needs an
 * app update; one the host offers but the manifest never asked permission
 * for is a package defect.
 */
export function assertPluginCapabilityRequirements(manifest: PluginManifest): void {
  const available = resolvePluginCapabilities(manifest);
  for (const family of Object.keys(manifest.requires) as Array<keyof typeof manifest.requires>) {
    const requirements = manifest.requires[family] ?? {};
    const versions = available[family] as Record<string, string | undefined>;
    for (const [id, range] of Object.entries(requirements)) {
      const version = versions[id];
      if (!version) {
        throw new AppError(
          Object.hasOwn(HOST_CATALOGS[family], id) ? ERR_PLUGIN_INVALID_PACKAGE : ERR_PLUGIN_APP_UPDATE_REQUIRED,
          `requires unavailable capability ${family}.${id} ${String(range)} (check permissions)`,
        );
      }
      if (!satisfies(version, String(range), { includePrerelease: true })) {
        throw new AppError(
          gtr(version, String(range), { includePrerelease: true })
            ? ERR_PLUGIN_UPDATE_REQUIRED
            : ERR_PLUGIN_APP_UPDATE_REQUIRED,
          `requires ${family}.${id} ${String(range)}, but the host provides ${version}`,
        );
      }
    }
  }
}
