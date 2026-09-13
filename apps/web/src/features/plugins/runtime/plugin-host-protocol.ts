import { AppError, HOST_CAPABILITY_CATALOG } from "@read-aware/core";
import type { PluginBookAccess, PluginContext, PluginManifest, PluginMigration } from "@read-aware/plugin-types";
import { validateManifest } from "../lib/manifest";
import { assertPluginWireBudget, PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";
import { PLUGIN_PROTOCOL_VERSION, validPluginCallId } from "./plugin-worker-protocol";

export type ContextShape = { [key: string]: "fn" | ContextShape };
type Phase = PluginContext["lifecycle"]["phase"];
export type HostMessage =
  | { t: "boot"; protocolVersion: typeof PLUGIN_PROTOCOL_VERSION; url: string; manifest: PluginManifest;
      appVersion: string; capabilities: PluginContext["capabilities"]; grants: PluginContext["grants"]; shape: ContextShape;
      storage: Record<string, string>; locale: string; phase: Phase }
  | { t: "invoke"; id: number; handle: string; args: unknown[] }
  | { t: "sync"; patch: { storage?: Record<string, string>; locale?: string; phase?: Phase } }
  | { t: "result"; id: number; ok: true; value: unknown; disposable?: string }
  | { t: "result"; id: number; ok: false; error: string; code?: string }
  | { t: "release"; handles: string[] }
  | { t: "health"; id: number }
  | { t: "migrate"; id: number; migration: PluginMigration }
  | { t: "quiesce" }
  | { t: "deactivate" };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const phase = (value: unknown) => value === "activating" || value === "migrating" || value === "active";
const handle = (value: unknown): value is string => typeof value === "string" && /^h[1-9][0-9]{0,15}$/.test(value);
const storage = (value: unknown) => record(value) && Object.values(value).every(entry => typeof entry === "string");
function shape(value: unknown, depth = 0): boolean {
  return depth <= 10 && record(value) && Object.entries(value).every(([key, entry]) =>
    /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key)
    && (entry === "fn" || shape(entry, depth + 1)));
}
function capabilities(value: unknown): boolean {
  return record(value) && keys(value, Object.keys(HOST_CAPABILITY_CATALOG))
    && Object.entries(HOST_CAPABILITY_CATALOG).every(([family, catalog]) => {
      const entries = value[family];
      return record(entries) && Object.entries(entries).every(([key, version]) =>
        Object.prototype.hasOwnProperty.call(catalog, key) && text(version, 128) && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version));
    });
}
function bookAccess(value: unknown): value is PluginBookAccess {
  if (!record(value) || typeof value.mode !== "string") return false;
  if (value.mode === "all" || value.mode === "current") return keys(value, ["mode"]);
  return value.mode === "book" && keys(value, ["mode", "bookId"])
    && text(value.bookId, 512) && value.bookId.trim().length > 0;
}
function grants(value: unknown): value is PluginContext["grants"] {
  return record(value) && keys(value, ["book"]) && bookAccess(value.book);
}

/** Envelope validation shares the install-time manifest parser, not a second manifest schema. */
export function parsePluginHostMessage(value: unknown, account?: (usage: { bytes: number; entries: number }) => void): HostMessage {
  assertPluginWireBudget(value, PLUGIN_WIRE_LIMITS, account);
  let valid = false;
  if (record(value)) switch (value.t) {
    case "boot":
      valid = keys(value, ["t", "protocolVersion", "url", "manifest", "appVersion", "capabilities", "grants", "shape", "storage", "locale", "phase"])
        && value.protocolVersion === PLUGIN_PROTOCOL_VERSION && text(value.url, 8192) && value.url.length > 0
        && text(value.appVersion, 128) && value.appVersion.length > 0 && capabilities(value.capabilities)
        && grants(value.grants)
        && shape(value.shape) && storage(value.storage) && text(value.locale, 128) && phase(value.phase);
      if (valid) { try { validateManifest(value.manifest); } catch { valid = false; /* Map parser diagnostics to the stable wire error. */ } }
      break;
    case "invoke": valid = keys(value, ["t", "id", "handle", "args"]) && validPluginCallId(value.id)
      && handle(value.handle) && Array.isArray(value.args); break;
    case "sync": valid = keys(value, ["t", "patch"]) && record(value.patch) && keys(value.patch, ["storage", "locale", "phase"])
      && (value.patch.storage === undefined || storage(value.patch.storage))
      && (value.patch.locale === undefined || text(value.patch.locale, 128))
      && (value.patch.phase === undefined || phase(value.patch.phase)); break;
    case "result": valid = validPluginCallId(value.id) && (value.ok === true
      ? keys(value, ["t", "id", "ok", "value", "disposable"]) && Object.prototype.hasOwnProperty.call(value, "value")
        && (value.disposable === undefined || (text(value.disposable, 128) && value.disposable.length > 0))
      : value.ok === false && keys(value, ["t", "id", "ok", "error", "code"]) && text(value.error, 4096)
        && (value.code === undefined || text(value.code, 256))); break;
    case "release": valid = keys(value, ["t", "handles"]) && Array.isArray(value.handles)
      && value.handles.length <= PLUGIN_WIRE_LIMITS.callbacksPerMessage && value.handles.every(handle); break;
    case "health": valid = keys(value, ["t", "id"]) && validPluginCallId(value.id); break;
    case "migrate": valid = keys(value, ["t", "id", "migration"]) && validPluginCallId(value.id) && record(value.migration)
      && keys(value.migration, ["fromVersion", "toVersion", "direction"])
      && Number.isSafeInteger(value.migration.fromVersion) && (value.migration.fromVersion as number) >= 0
      && validPluginCallId(value.migration.toVersion)
      && (value.migration.direction === "upgrade" ? (value.migration.toVersion as number) > (value.migration.fromVersion as number)
        : value.migration.direction === "downgrade" && (value.migration.toVersion as number) < (value.migration.fromVersion as number)); break;
    case "quiesce": case "deactivate": valid = keys(value, ["t"]); break;
  }
  if (!valid) throw new AppError("plugin/invalid-input", "Invalid plugin host message or transport version");
  return value as HostMessage;
}
