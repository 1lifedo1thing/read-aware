import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { assertOperationAvailable } from "@read-aware/core";
import { inspectInferenceAvailability, checkOperationAvailability } from "./operation-availability";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { AIConfig } from "../features/ai/lib/ai-config";
import * as aiConfig from "../features/ai/lib/ai-config";
import { getSecret, setSecret, deleteSecret } from "../platform/secret-store";
import { getAgentRuntime } from "../features/ai/agent/agent-runtime";
import { readingRuntime } from "../domain/reading-runtime";

const input = { operation: "llm.infer" as const };
const configured: AIConfig = { provider: "custom", apiKey: "private-credential", model: "private-model", customBaseUrl: "https://private.example/v1" };
let savedStorage: PropertyDescriptor | undefined;
beforeEach(() => {
  savedStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
});

test("public reading prerequisites authorize the target before inspecting it and sanitize unavailable adapters", async () => {
  const query = { operation: "reading.playback" as const, bookId: "book", action: "start" as const };
  const inspect = spyOn(readingRuntime, "operationAvailability");
  const readAI = spyOn(aiConfig, "getAIConfig");
  const clients = [
    buildPluginContext({ id: "reader-metadata-only", name: "Read", version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:read"] }, "1", []),
    buildPluginContext({ id: "reader-writer", name: "Write", version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:write"] }, "1", [], { mode: "book", bookId: "book" }),
  ];
  clients.forEach(client => client.lifecycle.promote());
  try {
    const [denied, allowed] = clients;
    expect((await denied!.context.services.session.operationAvailability(query)).conditions).toEqual([
      { kind: "permission", state: "unavailable", reason: "reading:write-required" },
    ]);
    expect((await allowed!.context.services.session.operationAvailability({ ...query, bookId: "foreign" })).conditions).toEqual([
      { kind: "permission", state: "unavailable", reason: "book-scope-required", errorCode: "plugin/object-access-denied" },
    ]);
    expect(inspect).not.toHaveBeenCalled();
    expect((await allowed!.context.services.session.operationAvailability(query)).conditions).toContainEqual(expect.objectContaining({ reason: "no-reading-session" }));
    expect(readAI).not.toHaveBeenCalled();
    inspect.mockImplementation(() => { throw new Error("PRIVATE_ADAPTER_FAILURE"); });
    const failure = await allowed!.context.services.session.operationAvailability(query);
    expect(failure.state).toBe("unknown"); expect(JSON.stringify(failure)).not.toContain("PRIVATE");
  } finally { inspect.mockRestore(); readAI.mockRestore(); for (const client of clients) { client.lifecycle.stop(); await client.lifecycle.drainCleanups(); } }
});

test("current-book prerequisite result is retired when the reader changes in flight", async () => {
  readingRuntime.begin("book");
  const client = buildPluginContext({ id: "current-prerequisites", name: "Current", version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:write"] }, "1", [], { mode: "current" });
  client.lifecycle.promote();
  try {
    const pending = client.context.services.session.operationAvailability({ operation: "reading.playback", bookId: "book", action: "start" });
    readingRuntime.begin("foreign");
    await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" });
  } finally { readingRuntime.closed(); client.lifecycle.stop(); await client.lifecycle.drainCleanups(); }
});
afterEach(() => { if (savedStorage) Object.defineProperty(globalThis, "localStorage", savedStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });

test("inference prerequisites use actual model/account mapping without disclosing or probing their configuration", async () => {
  expect(inspectInferenceAvailability(input, null).state).toBe("unconfigured");
  expect(inspectInferenceAvailability(input, { ...configured, apiKey: "" }).conditions).toContainEqual(expect.objectContaining({ kind: "account", state: "unconfigured" }));
  expect(inspectInferenceAvailability(input, { ...configured, model: "" }).state).toBe("unconfigured");
  const text = inspectInferenceAvailability(input, configured);
  expect(text.state).toBe("unknown"); expect(text.remoteChecked).toBe(false);
  expect(() => assertOperationAvailable(text)).not.toThrow();
  expect(JSON.stringify(text)).not.toContain("private");
  expect(inspectInferenceAvailability(input, { ...configured, customBaseUrl: "file:///private" }).state).toBe("unavailable");
  const images = inspectInferenceAvailability({ ...input, images: true }, { ...configured, provider: "openai", model: "unlisted-model" });
  expect(images.conditions).toContainEqual(expect.objectContaining({ kind: "input", state: "unavailable" }));
  const oldSession = getSecret("sync.session");
  setSecret("sync.session", "subscription-session");
  const read = spyOn(aiConfig, "getAIConfig").mockReturnValue({ provider: "readaware", apiKey: "", model: "deepseek-v4-flash" });
  try {
    const subscription = inspectInferenceAvailability(input, { provider: "readaware", apiKey: "", model: "deepseek-v4-flash" });
    expect(subscription.conditions).toContainEqual(expect.objectContaining({ kind: "account", state: "satisfied" }));
    expect(JSON.stringify(subscription)).not.toContain("subscription-session");
    expect(getAgentRuntime()).not.toBeNull();
    deleteSecret("sync.session"); expect(getAgentRuntime()).toBeNull();
  } finally { read.mockRestore(); if (oldSession) setSecret("sync.session", oldSession); else deleteSecret("sync.session"); }
});

test("public plugin query gates disclosure before reading configuration and distinguishes failed reads", async () => {
  const read = spyOn(aiConfig, "getAIConfig").mockReturnValue(configured);
  const denied = buildPluginContext({ id: "no-inference", name: "No inference", version: "1", schemaVersion: 1, requires: {} }, "1", []);
  const allowed = buildPluginContext({ id: "inference", name: "Inference", version: "1", schemaVersion: 1, requires: {}, permissions: ["service:llm"] }, "1", [], { mode: "book", bookId: "only-this-book" });
  denied.lifecycle.promote(); allowed.lifecycle.promote();
  try {
    const hidden = await denied.context.services.session.operationAvailability(input);
    expect(hidden.conditions).toEqual([{ kind: "permission", state: "unavailable", reason: "service:llm-required" }]);
    expect(read).not.toHaveBeenCalled();
    expect((await allowed.context.services.session.operationAvailability(input)).state).toBe("unknown");
    expect(read).toHaveBeenCalledWith({ migrateLegacy: false, strict: true });
    read.mockImplementation(() => { throw new Error("private parse failure"); });
    const failed = await checkOperationAvailability(input);
    expect(failed.state).toBe("unknown"); expect(failed.conditions[0]!.reason).toBe("configuration-read-failed");
    expect(JSON.stringify(failed)).not.toContain("private");
    const abort = new AbortController(); abort.abort(new Error("retired"));
    expect(() => allowed.context.services.session.operationAvailability(input, { signal: abort.signal })).toThrow("retired");
  } finally { read.mockRestore(); for (const runtime of [denied, allowed]) { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); } }
  expect(() => allowed.context.services.session.operationAvailability(input)).toThrow();
});
