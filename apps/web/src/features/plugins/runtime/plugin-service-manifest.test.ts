import { expect, test } from "bun:test";
import { validateManifest } from "../lib/manifest";

test("service exporters require a compatible host contract and cannot declare permissions they lack", () => {
  const manifest = { id: "service-provider", name: "Provider", version: "1.0.0", schemaVersion: 1, permissions: ["library:write"],
    requires: { services: { plugins: "^1.8.0" } }, services: [{ id: "page", version: "1.0.0", title: "Page", description: "Book page", scope: "book", permissions: ["library:read"], input: { type: "null" }, output: { type: "null" } }] };
  expect(validateManifest(manifest).services).toHaveLength(1);
  for (const invalid of [{ ...manifest, requires: {} }, { ...manifest, requires: { services: { plugins: "^1.7.0" } } },
    { ...manifest, permissions: [] }, { ...manifest, services: [manifest.services[0], manifest.services[0]] },
    { ...manifest, services: [{ ...manifest.services[0], input: { type: "object", additionalProperties: true } }] }]) expect(() => validateManifest(invalid)).toThrow();
});
