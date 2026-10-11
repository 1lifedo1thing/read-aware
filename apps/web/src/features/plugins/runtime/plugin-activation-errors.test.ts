import { describe, expect, test } from "bun:test";
import {
  ERR_PLUGIN_APP_UPDATE_REQUIRED,
  ERR_PLUGIN_INVALID_PACKAGE,
  ERR_PLUGIN_UPDATE_REQUIRED,
  HOST_SERVICE_CATALOG,
  errorCode,
} from "@read-aware/core";
import { validateManifest } from "../lib/manifest";
import type { PluginManifest } from "../lib/plugin-types";
import { assertPluginCapabilityRequirements } from "./plugin-capabilities";
import { assertPluginManifestCanActivate } from "./plugin-manifest-readiness";

function manifest(patch: Partial<PluginManifest> = {}): PluginManifest {
  return { id: "sample", name: "Sample", version: "1.0.0", schemaVersion: 1, requires: {}, ...patch };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return errorCode(error);
  }
  throw new Error("expected a failure");
}

describe("activation failures name who must update", () => {
  test("a requirement the host has outgrown asks for a plugin update", () => {
    // Theme Schedule 1.0.1 shipped against storage 1.x and schedules 1.x.
    expect(
      codeOf(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { storage: "^1.0.0" } } }))),
    ).toBe(ERR_PLUGIN_UPDATE_REQUIRED);
    expect(
      codeOf(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { schedules: "~1.0.0" } } }))),
    ).toBe(ERR_PLUGIN_UPDATE_REQUIRED);
  });

  test("a requirement newer than the host asks for an app update", () => {
    const [major] = HOST_SERVICE_CATALOG.storage.version.split(".");
    const future = `^${Number(major) + 1}.0.0`;
    expect(
      codeOf(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { storage: future } } }))),
    ).toBe(ERR_PLUGIN_APP_UPDATE_REQUIRED);
    expect(
      codeOf(() =>
        assertPluginManifestCanActivate(manifest({ minAppVersion: "99.0.0" }), { appVersion: "0.6.5", builtin: false }),
      ),
    ).toBe(ERR_PLUGIN_APP_UPDATE_REQUIRED);
  });

  test("a capability used without its permission is a package defect", () => {
    expect(
      codeOf(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { network: "^2.0.0" } } }))),
    ).toBe(ERR_PLUGIN_INVALID_PACKAGE);
    expect(
      codeOf(() =>
        assertPluginManifestCanActivate(manifest({ permissions: ["reader:modes"] }), {
          appVersion: "0.6.5",
          builtin: false,
        }),
      ),
    ).toBe(ERR_PLUGIN_INVALID_PACKAGE);
  });

  test("names this host does not know mean the plugin targets a newer app", () => {
    const base = { id: "sample", name: "Sample", version: "1.0.0", schemaVersion: 1 };
    expect(codeOf(() => validateManifest({ ...base, requires: { services: { telepathy: "^1.0.0" } } }))).toBe(
      ERR_PLUGIN_APP_UPDATE_REQUIRED,
    );
    expect(codeOf(() => validateManifest({ ...base, requires: { futureFamily: {} } }))).toBe(
      ERR_PLUGIN_APP_UPDATE_REQUIRED,
    );
    expect(codeOf(() => validateManifest({ ...base, requires: {}, permissions: ["future:power"] }))).toBe(
      ERR_PLUGIN_APP_UPDATE_REQUIRED,
    );
  });

  test("malformed manifests stay invalid packages", () => {
    const base = { id: "sample", name: "Sample", version: "1.0.0", schemaVersion: 1 };
    expect(codeOf(() => validateManifest({ ...base, requires: {}, permissions: [42] }))).toBe(
      ERR_PLUGIN_INVALID_PACKAGE,
    );
    expect(codeOf(() => validateManifest({ ...base, requires: { services: { storage: "not a range" } } }))).toBe(
      ERR_PLUGIN_INVALID_PACKAGE,
    );
    expect(codeOf(() => validateManifest({ ...base, requires: [] }))).toBe(ERR_PLUGIN_INVALID_PACKAGE);
  });
});
