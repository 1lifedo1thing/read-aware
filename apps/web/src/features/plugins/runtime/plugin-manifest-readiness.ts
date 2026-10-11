/** Shared by normal activation and backup review; never runs plugin code. */
import { AppError, ERR_PLUGIN_APP_UPDATE_REQUIRED, ERR_PLUGIN_INVALID_PACKAGE } from "@read-aware/core";
import { versionSatisfies } from "../lib/manifest";
import type { PluginManifest } from "../lib/plugin-types";
import { assertPluginCapabilityRequirements } from "./plugin-capabilities";

export function assertPluginManifestCanActivate(
  manifest: PluginManifest,
  host: { appVersion: string; builtin: boolean },
): void {
  if (manifest.minAppVersion && !versionSatisfies(host.appVersion, manifest.minAppVersion)) {
    throw new AppError(ERR_PLUGIN_APP_UPDATE_REQUIRED, `requires app version ${manifest.minAppVersion} or newer`);
  }
  assertPluginCapabilityRequirements(manifest);
  if (manifest.permissions?.includes("reader:modes") && !host.builtin) {
    throw new AppError(ERR_PLUGIN_INVALID_PACKAGE, "reader:modes is currently reserved for built-in plugins");
  }
}
