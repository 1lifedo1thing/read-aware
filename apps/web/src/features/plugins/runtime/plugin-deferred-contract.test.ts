import { expect, test } from "bun:test";
import { validateManifest } from "../lib/manifest";
import { buildPluginContext } from "./plugin-context";
import { assertPluginCapabilityRequirements } from "./plugin-capabilities";

const manifest = { id: "deferred-contract", name: "Deferred", version: "1.0.0", schemaVersion: 1,
  requires: { services: { schedules: "^2.0.0" } }, schedules: [{ id: "work", label: "Work", mode: "deferred" as const }] };
test("deferred schedules are declared and negotiated rather than arbitrary scripts or silently ignored cadence", () => {
  expect(validateManifest(manifest).schedules).toEqual(manifest.schedules);
  expect(() => assertPluginCapabilityRequirements(validateManifest(manifest))).not.toThrow();
  expect(() => assertPluginCapabilityRequirements(validateManifest({ ...manifest, requires: { services: { schedules: "^1.1.0" } } }))).toThrow();
  for (const schedules of [[{ ...manifest.schedules[0], everyMinutes: 15 }], [{ id: "x", label: "X", mode: "unknown" }],
    [{ id: "x", label: "X", everyMinutes: 1 }], Array.from({ length: 65 }, (_, n) => ({ id: `task-${n}`, label: "X", mode: "deferred" }))]) {
    expect(() => validateManifest({ ...manifest, schedules })).toThrow();
  }
});
test("plugins cannot forge or delete host-owned schedule attempts through private KV", () => {
  const runtime = buildPluginContext(validateManifest(manifest), "1.0.0", []); runtime.lifecycle.promote();
  try {
    for (const key of ["schedule-state", "schedule-runs"]) {
      expect(() => runtime.context.services.storage.set(key, { forged: true })).toThrow();
      expect(() => runtime.context.services.storage.remove(key)).toThrow();
    }
  } finally { runtime.lifecycle.stop(); }
});
