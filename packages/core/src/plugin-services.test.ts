import { expect, test } from "bun:test";
import { clonePluginServiceData, normalizePluginServices, normalizePluginServiceSchema, validatePluginServiceValue, normalizePluginServiceCall } from "./plugin-services";
const schema = { type: "object", properties: { count: { type: "integer", minimum: 0, maximum: 5 }, tags: { type: "array", maxItems: 3, items: { type: "string", maxLength: 10 } } }, required: ["count"], additionalProperties: false } as const;
const contract = () => ({ id: "inspect", version: "1.0.0", title: "Inspect", description: "Inspect a book", scope: "book", permissions: ["library:read"], input: structuredClone(schema), output: { type: "null" } });
test("service contracts validate bounded data without coercion, extra fields, or executable schema", () => {
  const accepted = normalizePluginServiceSchema(schema);
  expect(validatePluginServiceValue(accepted, { count: 3, tags: ["yes"] })).toEqual({ count: 3, tags: ["yes"] });
  for (const value of [{ count: "3" }, { count: 3.5 }, { count: 9 }, {}, { count: 1, extra: 2 }, { count: 1, tags: ["too long string"] }]) expect(() => validatePluginServiceValue(accepted, value)).toThrow();
  for (const s of [{ $ref: "file:///secret" }, { type: "string", pattern: ".*" }, { type: "object", properties: {}, additionalProperties: true },
    { anyOf: [] }, { type: "array", items: { type: "null" }, maxItems: 1001 }, { ...schema, required: ["missing"] }]) expect(() => normalizePluginServiceSchema(s)).toThrow();
  expect(normalizePluginServices([contract()])).toHaveLength(1);
  for (const value of [[contract(), contract()], [{ ...contract(), id: "../bad" }], [{ ...contract(), permissions: ["raw:sql"] }]]) expect(() => normalizePluginServices(value)).toThrow();
});
test("service values refuse callbacks, secrets hidden behind accessors, cycles, non-JSON values and over-budget results", () => {
  let accessed = false; const accessor = { get value() { accessed = true; return "secret"; } }; const cyclic: unknown[] = []; cyclic.push(cyclic);
  for (const value of [accessor, cyclic, { callback() {} }, new Date(), new Uint8Array(2), { x: undefined }, { n: NaN }, { value: "x".repeat(1048577) }]) expect(() => clonePluginServiceData(value)).toThrow();
  expect(accessed).toBe(false);
  const sparse = new Array(1); Object.defineProperty(sparse, "extra", { value: "mask", enumerable: true });
  expect(() => clonePluginServiceData(sparse)).toThrow();
  expect(() => validatePluginServiceValue({ type: "null" }, () => {}, "plugin/service-result-invalid")).toThrow(expect.objectContaining({ code: "plugin/service-result-invalid" }));
  const service = { pluginId: "provider", id: "inspect", version: "1.0.0", generation: "generation" };
  expect(normalizePluginServiceCall({ service, bookId: "b", input: null })).toEqual({ service, bookId: "b", input: null });
  expect(() => normalizePluginServiceCall({ service, input: null, permissions: ["library:write"] })).toThrow();
});
