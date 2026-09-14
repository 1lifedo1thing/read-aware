import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { assertOperationAvailable } from "@read-aware/core";
import { inspectInferenceAvailability, checkOperationAvailability } from "./operation-availability";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { AIConfig } from "../features/ai/lib/ai-config";
import * as aiConfig from "../features/ai/lib/ai-config";
import { getSecret, setSecret, deleteSecret } from "../platform/secret-store";
import { getAgentRuntime } from "../features/ai/agent/agent-runtime";

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
