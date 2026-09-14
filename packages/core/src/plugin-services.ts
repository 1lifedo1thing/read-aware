import { AppError } from "./errors";
import { PLUGIN_PERMISSIONS, type PluginPermission } from "./capabilities";

/** Closed JSON Schema vocabulary. No executable validators, references, or coercion. */
export type PluginServiceSchema = { description?: string } & (
  | { type: "string"; maxLength?: number; enum?: string[] }
  | { type: "number" | "integer"; minimum?: number; maximum?: number }
  | { type: "boolean" | "null" }
  | { type: "array"; items: PluginServiceSchema; maxItems?: number }
  | { type: "object"; properties: Record<string, PluginServiceSchema>; required?: string[]; additionalProperties: false }
  | { anyOf: PluginServiceSchema[] }
);
export type PluginServiceDeclaration = {
  id: string; version: string; title: string; description: string;
  scope: "book" | "global";
  permissions: PluginPermission[];
  input: PluginServiceSchema; output: PluginServiceSchema;
};
export type PluginServiceRef = { pluginId: string; id: string; version: string; generation: string };
export type PluginServiceDescriptor = PluginServiceDeclaration & { ref: PluginServiceRef };
export type PluginServiceQuery = { pluginId?: string; id?: string; offset?: number; limit?: number };
export type PluginServicePage = { services: PluginServiceDescriptor[]; total: number; nextOffset: number | null };
export type PluginServiceCall = { service: PluginServiceRef; bookId?: string; input: unknown };
export type PluginServiceReceipt = { callId: string; service: PluginServiceRef; value: unknown };
export const PLUGIN_SERVICE_LIMITS = { bytes: 1024 * 1024, depth: 16, nodes: 16000, schemas: 512, timeoutMs: 120000 } as const;
export const pluginServiceError = (code = "plugin/invalid-argument") => new AppError(code, "Plugin service contract or invocation is invalid");
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fields = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const name = (v: unknown) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const bounded = (v: unknown, max: number) => typeof v === "string" && !!v.trim() && v.length <= max;
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Walk before stringify/clone: reject cycles, callbacks, accessors and exotic objects. */
export function clonePluginServiceData(value: unknown, maxBytes: number = PLUGIN_SERVICE_LIMITS.bytes): unknown {
  let nodes = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > PLUGIN_SERVICE_LIMITS.nodes || depth > PLUGIN_SERVICE_LIMITS.depth) throw pluginServiceError();
    if (v === null || typeof v === "boolean" || finite(v)) return;
    if (typeof v === "string") { if (v.length > maxBytes) throw pluginServiceError(); return; }
    if (!v || typeof v !== "object" || seen.has(v) || (!Array.isArray(v) && !plain(v))) throw pluginServiceError();
    seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) throw pluginServiceError();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor) || ["__proto__", "constructor", "prototype"].includes(key)) throw pluginServiceError();
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(v) && (Object.keys(v).length !== v.length || Object.keys(v).some((key, index) => key !== String(index)))) throw pluginServiceError();
    seen.delete(v);
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > maxBytes) throw pluginServiceError();
  return JSON.parse(json);
}

export function normalizePluginServiceSchema(input: unknown): PluginServiceSchema {
  const value = clonePluginServiceData(input, 65536); let nodes = 0;
  const check = (v: unknown, depth: number): void => {
    if (!plain(v) || ++nodes > PLUGIN_SERVICE_LIMITS.schemas || depth > 12
      || v.description !== undefined && !bounded(v.description, 512)) throw pluginServiceError();
    if ("anyOf" in v) {
      if (!fields(v, ["anyOf", "description"]) || !Array.isArray(v.anyOf) || !v.anyOf.length || v.anyOf.length > 8) throw pluginServiceError();
      v.anyOf.forEach(s => check(s, depth + 1)); return;
    }
    const allowed: Record<string, string[]> = { string: ["maxLength", "enum"], number: ["minimum", "maximum"], integer: ["minimum", "maximum"], boolean: [], null: [], array: ["items", "maxItems"], object: ["properties", "required", "additionalProperties"] };
    if (typeof v.type !== "string" || !Object.prototype.hasOwnProperty.call(allowed, v.type) || !fields(v, ["type", "description", ...allowed[v.type]!])) throw pluginServiceError();
    if (v.type === "object") {
      if (v.additionalProperties !== false || !plain(v.properties) || Object.keys(v.properties).length > 128) throw pluginServiceError();
      Object.values(v.properties).forEach(s => check(s, depth + 1));
      if (v.required !== undefined && (!Array.isArray(v.required) || v.required.length > 128 || new Set(v.required).size !== v.required.length
        || v.required.some(k => typeof k !== "string" || !Object.prototype.hasOwnProperty.call(v.properties!, k)))) throw pluginServiceError();
    } else if (v.type === "array") {
      check(v.items, depth + 1);
      if (v.maxItems !== undefined && (!Number.isSafeInteger(v.maxItems) || Number(v.maxItems) < 0 || Number(v.maxItems) > 1000)) throw pluginServiceError();
    } else if (v.type === "string") {
      if (v.maxLength !== undefined && (!Number.isSafeInteger(v.maxLength) || Number(v.maxLength) < 0 || Number(v.maxLength) > 262144)) throw pluginServiceError();
      if (v.enum !== undefined && (!Array.isArray(v.enum) || !v.enum.length || v.enum.length > 100 || v.enum.some(x => typeof x !== "string" || x.length > 1024))) throw pluginServiceError();
    } else if (v.type === "number" || v.type === "integer") {
      if (v.minimum !== undefined && !finite(v.minimum) || v.maximum !== undefined && !finite(v.maximum)
        || finite(v.minimum) && finite(v.maximum) && Number(v.minimum) > Number(v.maximum)) throw pluginServiceError();
    }
  };
  check(value, 0); return value as PluginServiceSchema;
}

export function validatePluginServiceValue(schema: PluginServiceSchema, input: unknown, code = "plugin/invalid-argument"): unknown {
  let value: unknown;
  try { value = clonePluginServiceData(input); } catch { throw pluginServiceError(code); }
  const matches = (s: PluginServiceSchema, v: unknown): boolean => {
    if ("anyOf" in s) return s.anyOf.some(item => matches(item, v));
    switch (s.type) {
      case "null": return v === null;
      case "boolean": return typeof v === "boolean";
      case "number": case "integer": return finite(v) && (s.type !== "integer" || Number.isSafeInteger(v))
        && (s.minimum === undefined || Number(v) >= s.minimum) && (s.maximum === undefined || Number(v) <= s.maximum);
      case "string": return typeof v === "string" && v.length <= (s.maxLength ?? 262144) && (!s.enum || s.enum.includes(v));
      case "array": return Array.isArray(v) && v.length <= (s.maxItems ?? 1000) && v.every(item => matches(s.items, item));
      case "object": return plain(v) && (s.required ?? []).every(k => Object.prototype.hasOwnProperty.call(v, k))
        && Object.keys(v).every(k => Object.prototype.hasOwnProperty.call(s.properties, k) && matches(s.properties[k]!, v[k]));
    }
  };
  if (!matches(schema, value)) throw pluginServiceError(code);
  return value;
}

export function normalizePluginServices(input: unknown): PluginServiceDeclaration[] {
  if (input === undefined) return [];
  const value = clonePluginServiceData(input, 256 * 1024);
  if (!Array.isArray(value) || value.length > 32) throw pluginServiceError();
  const ids = new Set<string>();
  return value.map(v => {
    if (!plain(v) || !fields(v, ["id", "version", "title", "description", "scope", "permissions", "input", "output"])
      || !name(v.id) || ids.has(String(v.id)) || !bounded(v.version, 128) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(String(v.version))
      || !bounded(v.title, 200) || !bounded(v.description, 2000) || !["book", "global"].includes(String(v.scope))
      || !Array.isArray(v.permissions) || v.permissions.some(p => !PLUGIN_PERMISSIONS.includes(p as PluginPermission))) throw pluginServiceError();
    ids.add(String(v.id));
    return { ...v, input: normalizePluginServiceSchema(v.input), output: normalizePluginServiceSchema(v.output) } as PluginServiceDeclaration;
  });
}

export function normalizePluginServiceQuery(input: PluginServiceQuery = {}): Required<Pick<PluginServiceQuery, "limit" | "offset">> & PluginServiceQuery {
  if (!plain(input) || !fields(input, ["pluginId", "id", "limit", "offset"]) || input.pluginId !== undefined && !name(input.pluginId)
    || input.id !== undefined && !name(input.id) || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50)
    || input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 10000)) throw pluginServiceError();
  return { ...input, offset: input.offset ?? 0, limit: input.limit ?? 20 };
}
export function normalizePluginServiceCall(input: unknown): PluginServiceCall {
  if (!plain(input) || !fields(input, ["service", "bookId", "input"]) || !plain(input.service)
    || !fields(input.service, ["pluginId", "id", "version", "generation"]) || !name(input.service.pluginId) || !name(input.service.id)
    || !bounded(input.service.version, 128) || !bounded(input.service.generation, 80)
    || input.bookId !== undefined && !bounded(input.bookId, 256) || !Object.prototype.hasOwnProperty.call(input, "input")) throw pluginServiceError();
  return { service: { ...input.service } as PluginServiceRef, ...(input.bookId === undefined ? {} : { bookId: input.bookId as string }), input: clonePluginServiceData(input.input) };
}
