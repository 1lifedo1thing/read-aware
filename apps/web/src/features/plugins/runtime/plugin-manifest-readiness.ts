/** Shared by normal activation and backup review; never runs plugin code. */
import { versionSatisfies } from "../lib/manifest";
import type { PluginManifest } from "../lib/plugin-types";
import { assertPluginCapabilityRequirements } from "./plugin-capabilities";

export function assertPluginManifestCanActivate(
  manifest: PluginManifest,
  host: { appVersion: string; builtin: boolean },
): void {
  if (manifest.minAppVersion && !versionSatisfies(host.appVersion, manifest.minAppVersion)) {
    throw new Error(`requires app version ${manifest.minAppVersion} or newer`);
  }
  assertPluginCapabilityRequirements(manifest);
  if (manifest.permissions?.includes("reader:modes") && !host.builtin) {
    throw new Error("reader:modes is currently reserved for built-in plugins");
  }
}
