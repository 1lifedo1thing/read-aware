import { expect, test } from "bun:test";
import { parsePluginHostMessage, type HostMessage } from "./plugin-host-protocol";
import { parsePluginWorkerMessage } from "./plugin-worker-protocol";

const boot: HostMessage = { t: "boot", protocolVersion: 1, url: "https://localhost/plugin.js",
  manifest: { id: "protocol-test", name: "Protocol test", version: "1.0.0", schemaVersion: 1, requires: {} },
  appVersion: "1.0.0", capabilities: { domains: { memory: "2.5.0" }, services: {}, contributions: {}, schemas: {} },
  shape: { services: { storage: { get: "fn" } } }, storage: { item: "{}" }, locale: "en", phase: "activating" };

test("every host envelope is explicit and preserves opaque business data", () => {
  const value: { self?: unknown; bytes: Uint8Array; __fn: string } = { bytes: new Uint8Array([1, 2]), __fn: "ordinary" }; value.self = value;
  const messages: HostMessage[] = [boot, { t: "invoke", id: 1, handle: "h1", args: [value] },
    { t: "sync", patch: { locale: "zh-Hans", phase: "migrating", storage: { key: "value" } } },
    { t: "result", id: 1, ok: true, value, disposable: "d1" },
    { t: "result", id: 1, ok: false, code: "db/locked", error: "locked" },
    { t: "release", handles: ["h1", "h2"] }, { t: "health", id: 1 },
    { t: "migrate", id: 1, migration: { fromVersion: 0, toVersion: 1, direction: "upgrade" } },
    { t: "migrate", id: 2, migration: { fromVersion: 2, toVersion: 1, direction: "downgrade" } },
    { t: "quiesce" }, { t: "deactivate" }];
  for (const message of messages) {
    const cloned = structuredClone(message);
    expect(parsePluginHostMessage(cloned)).toBe(cloned);
    expect(() => parsePluginHostMessage({ ...message, authority: true })).toThrow();
  }
});

test("malformed mirrors, callback calls, migrations and bootstrap shapes are rejected", () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const message of [null, [], {}, { ...boot, protocolVersion: 0 }, { ...boot, protocolVersion: undefined },
    { ...boot, shape: cycle }, { ...boot, shape: { constructor: "fn" } }, { ...boot, shape: { x: [] } },
    { ...boot, capabilities: { ...boot.capabilities, services: { unknown: "1.0.0" } } },
    { ...boot, manifest: { ...boot.manifest, schemaVersion: -1 } }, { ...boot, storage: { x: false } },
    { t: "invoke", id: 1, handle: "h1", args: {} }, { t: "invoke", id: 1, handle: "unknown", args: [] },
    { t: "sync", patch: { storage: { x: 1 } } }, { t: "sync", patch: { phase: "stopped" } },
    { t: "sync", patch: { locale: "en", extra: true } }, { t: "result", id: 1, ok: true },
    { t: "result", id: 1, ok: false, error: "x".repeat(4097) }, { t: "release", handles: ["invalid"] },
    { t: "migrate", id: 1, migration: { from: 1, to: 2, direction: "upgrade" } },
    { t: "migrate", id: 1, migration: { fromVersion: 2, toVersion: 1, direction: "upgrade" } },
  ]) expect(() => parsePluginHostMessage(message)).toThrow();
  for (const id of [0, -1, NaN, Infinity, 1.1, "1", Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parsePluginHostMessage({ t: "health", id })).toThrow();
  }
  expect(() => parsePluginHostMessage({ t: "result", id: 1, ok: true, value: new Array(1_000_001) })).toThrow();
  for (const t of ["hello", "ready"]) for (const version of [undefined, 0, 2, "1"]) {
    expect(() => parsePluginWorkerMessage({ t, protocolVersion: version, ...(t === "ready" ? { hasMigration: false } : {}) })).toThrow();
  }
});
