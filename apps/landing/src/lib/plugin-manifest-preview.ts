import { PLUGIN_PERMISSIONS, type PluginPermission } from "@read-aware/core";
import { intersects, satisfies, validRange } from "semver";
import { CAPABILITIES } from "./plugin-capabilities";

type KnownPermission = PluginPermission;
type RequirementFamily = "domains" | "contributions" | "services" | "schemas";
type SettingsOperation = "discover" | "read" | "write";

export const KNOWN_PERMISSION_SET = new Set<string>(PLUGIN_PERMISSIONS);
const SETTINGS_PATH = /^[a-z][a-zA-Z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)*(?:\.\*)?$/;
const REQUIREMENT_FAMILIES: RequirementFamily[] = [
  "domains",
  "contributions",
  "services",
  "schemas",
];
const SETTINGS_OPERATIONS: SettingsOperation[] = ["discover", "read", "write"];

export type PluginPermissionPreviewCopy = {
  inputLabel: string;
  inputHint: string;
  previewLabel: string;
  noAuthority: string;
  invalidJson: string;
  issuesTitle: string;
  permissionsTitle: string;
  settingsTitle: string;
  requirementsTitle: string;
  declarationsTitle: string;
  networkTitle: string;
  invalidNetworkAccess: string;
  missingNetworkAccess: string;
  invalidRequires: string;
  unknownRequirement: (value: string) => string;
  incompatibleRequirement: (value: string) => string;
  missingPermission: (value: string) => string;
  allOriginsWarning: string;
  catalogNotice: string;
  none: string;
  schemaVersion: string;
  schedules: (count: number) => string;
  themes: (count: number) => string;
  fonts: (count: number) => string;
  unknownPermission: (permission: string) => string;
  missingField: (field: string) => string;
  invalidSchemaVersion: string;
  invalidPermissions: string;
  invalidSettingsAccess: string;
  unknownSettingsOperation: (operation: string) => string;
  invalidSettingsGrant: (operation: string) => string;
  sectionGrantWarning: (path: string) => string;
  permissionDescriptions: Record<KnownPermission, string>;
  operationLabels: Record<SettingsOperation, string>;
  familyLabels: Record<RequirementFamily, string>;
};

export type ManifestPreview = {
  permissions: string[];
  grants: Array<{ operation: SettingsOperation; path: string }>;
  requirements: Array<{ family: RequirementFamily; id: string; range: string }>;
  origins: string[];
  declarations: {
    schemaVersion: unknown;
    schedules: number;
    themes: number;
    fonts: number;
  };
  issues: string[];
  warnings: string[];
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function inspectManifest(
  value: unknown,
  copy: PluginPermissionPreviewCopy,
): ManifestPreview {
  const manifest = recordOf(value);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!manifest) {
    return {
      permissions: [],
      grants: [],
      requirements: [],
      origins: [],
      declarations: {
        schemaVersion: undefined,
        schedules: 0,
        themes: 0,
        fonts: 0,
      },
      issues: [copy.invalidJson],
      warnings,
    };
  }

  for (const field of ["id", "name", "version", "requires"] as const) {
    if (manifest[field] == null || manifest[field] === "")
      issues.push(copy.missingField(field));
  }
  if (
    !Number.isInteger(manifest.schemaVersion) ||
    Number(manifest.schemaVersion) < 1
  ) {
    issues.push(copy.invalidSchemaVersion);
  }

  const permissions: string[] = [];
  if (manifest.permissions != null && !Array.isArray(manifest.permissions)) {
    issues.push(copy.invalidPermissions);
  } else {
    for (const permission of (manifest.permissions ?? []) as unknown[]) {
      const label = String(permission);
      permissions.push(label);
      if (!KNOWN_PERMISSION_SET.has(label))
        issues.push(copy.unknownPermission(label));
    }
  }

  const grants: ManifestPreview["grants"] = [];
  if (manifest.settingsAccess != null) {
    const settingsAccess = recordOf(manifest.settingsAccess);
    if (!settingsAccess) {
      issues.push(copy.invalidSettingsAccess);
    } else {
      for (const operation of Object.keys(settingsAccess)) {
        if (!SETTINGS_OPERATIONS.includes(operation as SettingsOperation)) {
          issues.push(copy.unknownSettingsOperation(operation));
          continue;
        }
        const paths = settingsAccess[operation];
        if (
          !Array.isArray(paths) ||
          paths.some(
            (path) => typeof path !== "string" || !SETTINGS_PATH.test(path),
          )
        ) {
          issues.push(copy.invalidSettingsGrant(operation));
          continue;
        }
        for (const path of paths as string[]) {
          grants.push({ operation: operation as SettingsOperation, path });
          if (path.endsWith(".*"))
            warnings.push(copy.sectionGrantWarning(path));
        }
      }
    }
  }

  const requirements: ManifestPreview["requirements"] = [];
  const requires = recordOf(manifest.requires);
  if (!requires) {
    issues.push(copy.invalidRequires);
  } else {
    for (const [family, rawEntries] of Object.entries(requires)) {
      const entries = recordOf(rawEntries);
      if (
        !REQUIREMENT_FAMILIES.includes(family as RequirementFamily) ||
        !entries
      ) {
        issues.push(copy.invalidRequires);
        continue;
      }
      for (const [id, range] of Object.entries(entries)) {
        requirements.push({
          family: family as RequirementFamily,
          id,
          range: String(range),
        });
        const capability = CAPABILITIES.find(
          (entry) => entry.key === `${family}:${id}`,
        );
        if (!capability) {
          issues.push(copy.unknownRequirement(`${family}:${id}`));
          continue;
        }
        if (
          typeof range !== "string" ||
          !validRange(range) ||
          !satisfies(capability.version, range, { includePrerelease: true })
        ) {
          issues.push(
            copy.incompatibleRequirement(
              `${family}:${id} ${String(range)} (host ${capability.version})`,
            ),
          );
        }
        if (
          capability.permissions.length &&
          !capability.permissions.some((permission) =>
            permissions.includes(permission),
          )
        ) {
          issues.push(
            copy.missingPermission(capability.permissions.join(" / ")),
          );
        }
      }
    }
  }

  const origins: string[] = [];
  if (manifest.networkAccess != null) {
    if (!permissions.includes("service:network"))
      issues.push(copy.missingPermission("service:network"));
    const networkRange = recordOf(requires?.services)?.network;
    if (
      typeof networkRange !== "string" ||
      !validRange(networkRange) ||
      intersects(networkRange, ">=0.0.0 <2.0.0")
    ) {
      issues.push(copy.incompatibleRequirement("services:network >=2.0.0"));
    }
    const network = recordOf(manifest.networkAccess);
    const values = network?.origins;
    const isOrigin = (value: unknown) => {
      if (typeof value !== "string" || value.length > 2048) return false;
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          [url.origin, `${url.origin}/`].includes(value)
        );
      } catch {
        return false;
      }
    };
    if (
      !network ||
      Object.keys(network).some((key) => key !== "origins") ||
      !Array.isArray(values) ||
      values.length > 32 ||
      (!(values.length === 1 && values[0] === "*") &&
        values.some((value) => !isOrigin(value)))
    ) {
      issues.push(copy.invalidNetworkAccess);
    } else {
      origins.push(
        ...new Set(
          (values as string[]).map((value) =>
            value === "*" ? value : new URL(value).origin,
          ),
        ),
      );
      if (origins.includes("*")) warnings.push(copy.allOriginsWarning);
    }
  }
  if (permissions.includes("service:network") && !origins.length)
    issues.push(copy.missingNetworkAccess);

  return {
    permissions: [...new Set(permissions)],
    origins,
    grants,
    requirements,
    declarations: {
      schemaVersion: manifest.schemaVersion,
      schedules: Array.isArray(manifest.schedules)
        ? manifest.schedules.length
        : 0,
      themes: Array.isArray(manifest.themes) ? manifest.themes.length : 0,
      fonts: Array.isArray(manifest.fonts) ? manifest.fonts.length : 0,
    },
    issues,
    warnings,
  };
}
