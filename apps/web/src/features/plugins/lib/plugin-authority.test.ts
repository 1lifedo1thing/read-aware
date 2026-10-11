import { expect, test } from "bun:test";
import { pluginUpdateWidensAuthority } from "./plugin-authority";
import type { PluginManifest } from "./plugin-types";

function manifest(patch: Partial<PluginManifest> = {}): PluginManifest {
  return { id: "sample", name: "Sample", version: "1.0.0", schemaVersion: 1, requires: {}, ...patch };
}

test("an update within the approved authority needs no new consent", () => {
  const current = manifest({
    permissions: ["service:network", "library:read"],
    settingsAccess: { discover: ["appearance.theme"], write: ["reading.*"] },
    networkAccess: { origins: ["https://a.example"] },
  });
  expect(pluginUpdateWidensAuthority(current, current)).toBe(false);
  expect(
    pluginUpdateWidensAuthority(
      current,
      manifest({
        permissions: ["library:read"],
        // write grants read and discover; a narrower subtree stays inside reading.*
        settingsAccess: { read: ["reading.theme"], discover: ["reading.*"], write: ["reading.font.*"] },
        networkAccess: { origins: [] },
      }),
    ),
  ).toBe(false);
});

test("Theme Schedule 1.0.1 → 1.1.0 keeps its authority", () => {
  const settingsAccess = {
    discover: ["appearance.theme", "reading.theme"],
    write: ["appearance.theme", "reading.theme"],
  };
  expect(
    pluginUpdateWidensAuthority(
      manifest({ version: "1.0.1", settingsAccess }),
      manifest({ version: "1.1.0", settingsAccess }),
    ),
  ).toBe(false);
});

test("a new permission, settings path, wider operation or origin needs consent", () => {
  const current = manifest({
    permissions: ["service:network"],
    settingsAccess: { read: ["appearance.theme"], write: ["reading.font.*"] },
    networkAccess: { origins: ["https://a.example"] },
  });
  expect(pluginUpdateWidensAuthority(current, manifest({ permissions: ["service:network", "library:read"] }))).toBe(
    true,
  );
  expect(pluginUpdateWidensAuthority(current, manifest({ settingsAccess: { read: ["appearance.motion"] } }))).toBe(
    true,
  );
  expect(pluginUpdateWidensAuthority(current, manifest({ settingsAccess: { write: ["appearance.theme"] } }))).toBe(
    true,
  );
  expect(pluginUpdateWidensAuthority(current, manifest({ settingsAccess: { write: ["reading.*"] } }))).toBe(true);
  expect(pluginUpdateWidensAuthority(current, manifest({ networkAccess: { origins: ["https://b.example"] } }))).toBe(
    true,
  );
});

test("an unrestricted network grant covers any origin", () => {
  const current = manifest({ permissions: ["service:network"], networkAccess: { origins: ["*"] } });
  expect(
    pluginUpdateWidensAuthority(
      current,
      manifest({ permissions: ["service:network"], networkAccess: { origins: ["https://b.example"] } }),
    ),
  ).toBe(false);
});
