import { expect, test } from "bun:test";
import type { PluginAgentContextBlock, PluginAgentRetrievalItem, PluginMemoryCandidate } from "@read-aware/plugin-types";
import { AppError } from "@read-aware/core";
import { registerAgentContextProviderContribution, registerAgentRetrievalProviderContribution,
  registerMemoryCandidateProviderContribution, registerToolContribution } from "../state/plugin-store";
import { getPluginAgentContext, getPluginAgentTools } from "./plugin-tools";
import { proposePluginMemories } from "./plugin-memory-candidates";
import { decodePluginCallbacks, PluginCallbackRegistry } from "./plugin-callback-wire";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { wrapReadingIntent } from "./plugin-reading-intents";
import { registerPluginContentProvider } from "./plugin-content-provider";
import { getContentProvider } from "../state/plugin-store";
import { DynamicOptionsCache } from "../../../domain/settings/dynamic-options";
import type { PluginBookContent, PluginSelectOption } from "@read-aware/plugin-types";

const scope = { kind: "global", threadId: "result-test" } as const;
const brand = { key: "result-test:source", pluginId: "result-test", pluginName: "Result Test", id: "source" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function wire<T>(value: T) {
  const callbacks = new PluginCallbackRegistry();
  const decoded = decodePluginCallbacks(callbacks.encode(value), (handle, args) => callbacks.invoke(handle, args), handles => callbacks.release(handles)) as T;
  return { callbacks, decoded };
}

test.each(["accepted", "cancelled", "retired", "invalid"])("context %s results retire callbacks and cannot inject stale provider data", async mode => {
  const pending = Promise.withResolvers<PluginAgentContextBlock[]>();
  const controller = new AbortController();
  const registration = registerAgentContextProviderContribution({ ...brand, provide: input => {
    expect(Object.keys(input).sort()).toEqual(["scope", "userText"]);
    return pending.promise;
  } });
  try {
    const read = getPluginAgentContext({ scope, userText: "Question", signal: controller.signal });
    if (mode === "cancelled") controller.abort();
    if (mode === "retired") registration.dispose();
    const result = wire(mode === "invalid" ? { extra: () => {} } : [{ content: "Context", extra: () => {} }]);
    pending.resolve(result.decoded as PluginAgentContextBlock[]);
    const blocks = await read;
    expect(blocks).toHaveLength(mode === "accepted" ? 1 : 0);
    expect(result.callbacks.size).toBe(0);
    expect(JSON.stringify(blocks)).not.toContain("extra");
  } finally { registration.dispose(); }
});

test("a provider retiring while another context source waits is excluded at final assembly", async () => {
  const pending = Promise.withResolvers<PluginAgentContextBlock[]>();
  const fast = registerAgentContextProviderContribution({ ...brand, provide: () => [{ content: "Retired" }] });
  const slow = registerAgentContextProviderContribution({ ...brand, key: "result-test:slow", id: "slow", provide: () => pending.promise });
  try {
    const read = getPluginAgentContext({ scope, userText: "Question" });
    await tick(); fast.dispose(); pending.resolve([{ content: "Current" }]);
    expect((await read).map(block => block.content)).toEqual(["Current"]);
  } finally { fast.dispose(); slow.dispose(); }
});

test.each(["accepted", "cancelled", "retired", "invalid"])("retrieval %s rechecks the read after completion and releases results", async mode => {
  const pending = Promise.withResolvers<PluginAgentRetrievalItem[]>();
  const registration = registerAgentRetrievalProviderContribution({ ...brand, label: "Search", description: "Search", retrieve: () => pending.promise });
  const controller = new AbortController();
  try {
    const tool = getPluginAgentTools(scope).find(tool => tool.name === "plugin_result_test_retrieve_source")!;
    const read = tool.execute("read", { query: "Query" }, controller.signal).catch(error => error);
    if (mode === "cancelled") controller.abort(new AppError("plugin/cancelled", "Turn cancelled"));
    if (mode === "retired") registration.dispose();
    const result = wire(mode === "invalid" ? { extra: () => {} } : [{ content: "Passage", extra: () => {} }]);
    pending.resolve(result.decoded as PluginAgentRetrievalItem[]);
    const output = await read;
    if (mode === "accepted") expect(output.content[0].text).toContain("Passage");
    else expect(output).toMatchObject({ code: mode === "cancelled" ? "plugin/cancelled" : mode === "retired" ? "plugin/unavailable" : "plugin/invalid-input" });
    expect(result.callbacks.size).toBe(0);
  } finally { registration.dispose(); }
});

test("memory proposals release discarded callbacks and receipt delivery releases unexpected return values", async () => {
  const proposals = wire(Array.from({ length: 5 }, (_, index) => ({ scope: "user", kind: "fact", content: String(index), extra: () => {} })));
  const acknowledgement = wire({ extra: () => {} });
  let discarded = -1;
  const provider = { ...brand, propose: () => proposals.decoded as PluginMemoryCandidate[],
    onResult: (receipt: { discarded: number }) => { discarded = receipt.discarded; return acknowledgement.decoded as never; } };
  const registration = registerMemoryCandidateProviderContribution(provider);
  try {
    const candidates = await proposePluginMemories(provider, { scope, userText: "Q", assistantText: "A" });
    expect(candidates).toHaveLength(3); expect(proposals.callbacks.size).toBe(0);
    for (const candidate of candidates) candidate.report?.({ status: "saved" });
    await tick(); expect(discarded).toBe(2); expect(acknowledgement.callbacks.size).toBe(0);
  } finally { registration.dispose(); }
});

test("retired memory proposals release late results without producing writable candidates", async () => {
  const pending = Promise.withResolvers<PluginMemoryCandidate[]>();
  const provider = { ...brand, propose: () => pending.promise };
  const registration = registerMemoryCandidateProviderContribution(provider);
  const read = proposePluginMemories(provider, { scope, userText: "Q", assistantText: "A" });
  registration.dispose();
  const result = wire([{ scope: "user", kind: "fact", content: "Late", extra: () => {} }]);
  pending.resolve(result.decoded as PluginMemoryCandidate[]);
  expect(await read).toEqual([]); expect(result.callbacks.size).toBe(0);
});

test("holes in a memory proposal array receive invalid outcomes instead of leaving the receipt pending", async () => {
  let receipt: unknown;
  const provider = { ...brand, propose: () => new Array<PluginMemoryCandidate>(2), onResult: (value: unknown) => { receipt = value; } };
  const registration = registerMemoryCandidateProviderContribution(provider);
  try {
    expect(await proposePluginMemories(provider, { scope, userText: "Q", assistantText: "A" })).toEqual([]);
    await tick();
    expect(receipt).toMatchObject({ results: [{ index: 0, outcome: { status: "rejected", reason: "invalid" } },
      { index: 1, outcome: { status: "rejected", reason: "invalid" } }] });
  } finally { registration.dispose(); }
});

test("tool JSON rejects remote serialization callbacks without invoking or retaining them", async () => {
  let calls = 0;
  const result = wire({ value: "not JSON", toJSON: () => { calls++; return {}; } });
  const registration = registerToolContribution({ ...brand, name: "json", description: "JSON", execute: () => result.decoded });
  try {
    const tool = getPluginAgentTools(scope).find(tool => tool.name === "plugin_result_test_json")!;
    await expect(tool.execute("json", {})).rejects.toMatchObject({ code: "plugin/invalid-input" });
    expect(calls).toBe(0); expect(result.callbacks.size).toBe(0);
  } finally { registration.dispose(); }
});

test("a dispatched tool still returns its completion receipt after cancellation or retirement", async () => {
  const pending = Promise.withResolvers<unknown>();
  const registration = registerToolContribution({ ...brand, name: "write", description: "Write", execute: () => pending.promise });
  const controller = new AbortController();
  const tool = getPluginAgentTools(scope).find(tool => tool.name === "plugin_result_test_write")!;
  const write = tool.execute("write", {}, controller.signal);
  controller.abort(); registration.dispose(); pending.resolve({ committed: true });
  expect((await write).content).toEqual([{ type: "text", text: '{"committed":true}' }]);
});

test("reading intention prepare and invalid read results release unused callback graphs", async () => {
  const preparation = wire({ extra: () => {} }), invalid = wire({ extra: () => {} });
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const source = wrapReadingIntent({ scopes: ["user"], prepare: async () => preparation.decoded as never, read: async () => invalid.decoded as never }, lifecycle)!;
  try {
    await source.prepare({ kind: "user" });
    expect(preparation.callbacks.size).toBe(0);
    await expect(source.read({ kind: "user" })).rejects.toBeDefined();
    expect(invalid.callbacks.size).toBe(0);
  } finally { lifecycle.stop(); await lifecycle.drainCleanups(); }
});

test.each(["accepted", "retired", "invalid"])("virtual book %s copies only content fields and releases source callbacks", async mode => {
  const pending = Promise.withResolvers<PluginBookContent>();
  const lifetime = new AbortController();
  let calls = 0;
  const registration = registerPluginContentProvider(brand.pluginId, { id: brand.id, load: () => { calls++; return pending.promise; } }, lifetime.signal);
  const provider = getContentProvider(brand.pluginId, brand.id)!;
  try {
    const read = provider.load("article").catch(error => error);
    if (mode === "retired") registration.dispose();
    const result = wire(mode === "invalid" ? { extra: () => {} } : { title: "Book", sections: [{ html: "<p>Text</p>", extra: () => {} }] });
    pending.resolve(result.decoded as PluginBookContent);
    const outcome = await read;
    if (mode === "accepted") {
      expect(outcome).toMatchObject({ title: "Book", sections: [{ html: "<p>Text</p>" }] });
      expect(JSON.stringify(outcome)).not.toContain("extra");
      expect(outcome.sections).not.toBe((result.decoded as PluginBookContent).sections);
    } else expect(outcome).toMatchObject({ code: mode === "retired" ? "library/content-unavailable" : "plugin/invalid-input" });
    expect(result.callbacks.size).toBe(0);
    lifetime.abort();
    await expect(provider.load("article")).rejects.toMatchObject({ code: "library/content-unavailable" });
    expect(calls).toBe(1);
  } finally { registration.dispose(); }
});

test.each(["accepted", "timeout", "invalid"])("dynamic options %s still release the eventual provider result", async mode => {
  const pending = Promise.withResolvers<PluginSelectOption[]>();
  const cache = new DynamicOptionsCache(() => {}, Date.now, 5);
  const read = cache.query({ path: "plugins.source.choice" }, { identity: {}, version: 1, pluginId: brand.pluginId,
    pluginName: brand.pluginName, current: () => true, load: () => pending.promise }).catch(error => error);
  await tick();
  if (mode === "timeout") expect(await read).toMatchObject({ code: "settings/options-unavailable" });
  const result = wire(mode === "invalid" ? { extra: () => {} } : [{ value: "one", label: "One", extra: () => {} }]);
  pending.resolve(result.decoded as PluginSelectOption[]);
  await read; await tick();
  expect(result.callbacks.size).toBe(0);
});
