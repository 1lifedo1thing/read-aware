import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { AppError, assertOperationAvailable } from "@read-aware/core";
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

test("graph prerequisites reject missing generation permission and foreign books before private reads", async () => {
  const readAI = spyOn(aiConfig, "getAIConfig");
  const clients = [
    buildPluginContext({ id: "graph-read", name: "Read", version: "1", schemaVersion: 1, requires: {}, permissions: ["memory:read"] }, "1", []),
    buildPluginContext({ id: "graph-write", name: "Write", version: "1", schemaVersion: 1, requires: {}, permissions: ["memory:write"] }, "1", []),
    buildPluginContext({ id: "graph-model", name: "Model", version: "1", schemaVersion: 1, requires: {}, permissions: ["memory:write", "service:llm"] }, "1", [], { mode: "book", bookId: "book" }),
  ];
  clients.forEach(client => client.lifecycle.promote());
  try {
    const query = { operation: "memory.graph.generate" as const, bookId: "foreign", mode: "rebuild" as const };
    for (const [index, reason] of ["memory:write-required", "service:llm-required", "book-scope-required"].entries()) {
      expect((await clients[index]!.context.services.session.operationAvailability(query)).conditions[0]!.reason).toBe(reason);
    }
    expect(readAI).not.toHaveBeenCalled();
  } finally { readAI.mockRestore(); for (const client of clients) { client.lifecycle.stop(); await client.lifecycle.drainCleanups(); } }
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


test("text prerequisites authorize before source reads, use the real owner, and sanitize lookup failures", async () => {
  const { BookTextRepository } = await import("../features/library/lib/book-text-repository");
  const inspect = spyOn(BookTextRepository.prototype, "preparationConditions").mockResolvedValue([{ kind: "provider", state: "unknown", reason: "source-download-not-checked" }]);
  const prepare = spyOn(BookTextRepository.prototype, "prepare");
  const clients = [
    buildPluginContext({ id: "no-text-write", name: "Read", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:read"] }, "1", []),
    buildPluginContext({ id: "text-writer", name: "Write", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:write"] }, "1", [], { mode: "book", bookId: "book" }),
  ];
  clients.forEach(client => client.lifecycle.promote());
  const input = { operation: "library.text.prepare" as const, bookId: "book", rebuild: true };
  try {
    expect((await clients[0]!.context.services.session.operationAvailability(input)).conditions).toEqual([{ kind: "permission", state: "unavailable", reason: "library:write-required" }]);
    expect((await clients[1]!.context.services.session.operationAvailability({ ...input, bookId: "foreign" })).conditions[0]!.reason).toBe("book-scope-required");
    expect(inspect).not.toHaveBeenCalled();
    const query = clients[1]!.context.services.session.operationAvailability;
    expect((await query(input)).conditions).toContainEqual({ kind: "capacity", state: "satisfied", reason: "text-task-capacity" });
    expect(inspect.mock.calls[0]!.slice(0, 2)).toEqual(["book", true]); expect(prepare).not.toHaveBeenCalled();
    inspect.mockRejectedValue(new AppError("library/book-not-found", "private book"));
    expect((await query(input)).conditions).toContainEqual(expect.objectContaining({ kind: "object", state: "unavailable", reason: "book-not-found" }));
    inspect.mockRejectedValue(new Error("PRIVATE_SOURCE_FAILURE"));
    const failure = await query(input); expect(failure.state).toBe("unknown"); expect(JSON.stringify(failure)).not.toContain("PRIVATE");
    expect((await checkOperationAvailability(input)).state).toBe("unknown");
  } finally { inspect.mockRestore(); prepare.mockRestore(); for (const client of clients) { client.lifecycle.stop(); await client.lifecycle.drainCleanups(); } }
});

test("current-book text query and real task admission share scope fences through pause/resume and terminal cleanup", async () => {
  const { BookTextRepository } = await import("../features/library/lib/book-text-repository");
  const { BookTextTaskHistory } = await import("../features/library/lib/book-text-task-history");
  const state = { bookId: "book", contentVersion: "v", status: "unprepared" as const, text: "unknown" as const, chapterCount: 0, progress: null };
  let gate: Promise<void> | undefined; const entered = Promise.withResolvers<void>(); const signals: AbortSignal[] = [];
  const spies = [
    spyOn(BookTextRepository.prototype, "preparationConditions").mockImplementation(async () => { if (gate) { entered.resolve(); await gate; } return [{ kind: "provider", state: "unknown", reason: "not-loaded" }]; }),
    spyOn(BookTextRepository.prototype, "snapshot").mockResolvedValue(state),
    spyOn(BookTextTaskHistory.prototype, "record").mockResolvedValue(),
    spyOn(BookTextRepository.prototype, "prepare").mockImplementation(async (_book, options) => new Promise((_resolve, reject) => {
      const signal = options!.signal!; signals.push(signal); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })),
  ];
  readingRuntime.begin("book");
  const client = buildPluginContext({ id: "current-text", name: "Text", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:write"] }, "1", [], { mode: "current" });
  client.lifecycle.promote();
  try {
    const input = { operation: "library.text.prepare" as const, bookId: "book" };
    expect((await client.context.services.session.operationAvailability(input)).state).toBe("unknown");
    const commands = client.context.domains.library!.commands!.books;
    const task = await commands.prepareText("book"); expect(task.status).toBe("running");
    expect((await commands.pauseTextTask("book", task.taskId)).status).toBe("paused"); expect(signals[0]!.aborted).toBe(true);
    expect((await commands.resumeTextTask("book", task.taskId)).status).toBe("running"); expect(signals[1]!.aborted).toBe(false);
    readingRuntime.begin("foreign"); expect(signals[1]!.aborted).toBe(true);
    await expect(commands.prepareText("book")).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    readingRuntime.begin("book");
    expect((await client.context.domains.library!.queries.books.getTextTask("book", task.taskId))!.status).toBe("cancelled");
    const wait = Promise.withResolvers<void>(); gate = wait.promise;
    const pending = commands.prepareText("book"); await entered.promise; readingRuntime.begin("foreign"); wait.resolve();
    await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" }); expect(signals).toHaveLength(2);
  } finally { readingRuntime.closed(); client.lifecycle.stop(); await client.lifecycle.drainCleanups(); for (const spy of spies) spy.mockRestore(); }
});

test("maintenance prerequisites hide native state from plugins without required permissions", async () => {
  const client = buildPluginContext({ id: "update-read", name: "Read", version: "1", schemaVersion: 1, requires: {}, permissions: [] }, "1", []);
  client.lifecycle.promote();
  try {
    expect((await client.context.services.session.operationAvailability({ operation: "maintenance.checkForUpdates" })).conditions)
      .toEqual([{ kind: "permission", state: "unavailable", reason: "service:network-required" }]);
    expect((await client.context.services.session.operationAvailability({ operation: "diagnostics.verifyProjections" })).conditions)
      .toEqual([{ kind: "permission", state: "unavailable", reason: "service:diagnostics-required" }]);
  } finally { client.lifecycle.stop(); await client.lifecycle.drainCleanups(); }
});
