import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { PluginInferenceReceipts } from "./plugin-inference-receipts";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { createPluginLlm } from "./plugin-llm";
import { inferenceHistoryStorage } from "./plugin-inference-history-storage";
import type { InferenceHistoryStorage } from "./plugin-inference-history";
import * as backend from "./plugin-backend";
import { withPluginDataBackup } from "../../../platform/plugin-data-access";

function storage() {
  let raw: string | null = null;
  const adapter: InferenceHistoryStorage = { key: crypto.randomUUID(), read: async () => raw, write: async value => { raw = value; }, run: work => work() };
  return { adapter, raw: () => raw, replace: (value: string | null) => { raw = value; } };
}
function active() { const lifecycle = new PluginLifecycleController([]); lifecycle.promote(); return lifecycle; }

test("named request history survives a new activation and never restores execution or cancellation authority", async () => {
  const f = storage(), oldLife = active(), newLife = active();
  const old = new PluginInferenceReceipts(oldLife, f.adapter), next = new PluginInferenceReceipts(newLife, f.adapter);
  let cancelled = 0;
  const pending = await old.begin("pending", () => { cancelled++; });
  expect(await next.get("pending")).toMatchObject({ status: "running", requestAvailable: false, interrupted: true, settled: false });
  await next.cancel("pending"); expect(cancelled).toBe(0);
  await expect(next.begin("pending", () => {})).rejects.toMatchObject({ code: "plugin/invalid-argument" });
  const fresh = await next.begin("fresh", () => {}); await fresh.finish(); await fresh.settle();
  await pending.finish(new AppError("ai/request-cancelled", "PRIVATE OUTPUT")); await pending.settle();
  expect(await next.list()).toHaveLength(2);
  expect(await next.get("pending")).toMatchObject({ status: "cancelled", requestAvailable: false, interrupted: false, settled: true });
  expect(f.raw()).not.toContain("PRIVATE OUTPUT");
  expect(await new PluginInferenceReceipts(active(), f.adapter).get("fresh")).toMatchObject({ status: "completed", requestAvailable: false });
});

test("a named call must persist its initial receipt before invoking the model; failed persistence does not dispatch", async () => {
  const f = storage(); let dispatches = 0, writes = 0;
  const persist = f.adapter.write;
  f.adapter.write = async () => { writes++; throw new AppError("db/error", "Disk failure"); };
  const runtime = { ask: async () => { dispatches++; return "ok"; }, askDetailed: async () => ({ value: "ok", attempts: [] }) };
  const api = createPluginLlm("p", active(), () => runtime as never, undefined, undefined, f.adapter);
  await expect(api.ask({ prompt: "PRIVATE PROMPT", requestId: "id" })).rejects.toMatchObject({ code: "db/error" });
  expect(dispatches).toBe(0); expect(writes).toBeGreaterThan(0);
  f.adapter.write = persist;
  expect(await api.getRequest("id")).toMatchObject({ status: "failed", settled: true, requestAvailable: false });
  expect(f.raw()).not.toContain("PRIVATE PROMPT");
});

test("concurrent duplicate names cannot dispatch twice and same-millisecond eviction stays bounded", async () => {
  const f = storage(), receipts = new PluginInferenceReceipts(active(), f.adapter);
  const attempts = await Promise.allSettled([receipts.begin("same", () => {}), receipts.begin("same", () => {})]);
  expect(attempts.filter(value => value.status === "fulfilled")).toHaveLength(1);
  for (const value of attempts) if (value.status === "fulfilled") { await value.value.finish(); await value.value.settle(); }
  for (let i = 0; i < 65; i++) { const entry = await receipts.begin(`id-${i}`, () => {}); await entry.finish(); await entry.settle(); }
  expect(await receipts.list()).toHaveLength(64);
  expect(await receipts.get("same")).toBeNull(); expect(await receipts.get("id-64")).toBeTruthy();
});

test("hidden owner storage joins backup exclusion and reloads restored state instead of returning a stale cache", async () => {
  const values = new Map<string, string>();
  const get = spyOn(backend, "pluginDocsGet").mockImplementation(async (owner, collection, id) => {
    expect(collection).toBe("_host_inference_history"); expect(id).toBe("recent");
    return values.has(owner) ? { json: values.get(owner)! } as never : null;
  });
  const put = spyOn(backend, "pluginDocsPut").mockImplementation(async (owner, _collection, _id, json) => { values.set(owner, json); });
  try {
    const receipts = new PluginInferenceReceipts(active(), inferenceHistoryStorage("a"));
    const entry = await receipts.begin("one", () => {}); await entry.finish(); await entry.settle();
    expect(await new PluginInferenceReceipts(active(), inferenceHistoryStorage("b")).list()).toEqual([]);
    await withPluginDataBackup("export", async () => {
      await expect(receipts.begin("blocked", () => {})).rejects.toMatchObject({ code: "backup/busy" });
    });
    await receipts.list();
    values.clear(); expect(await receipts.list()).toEqual([]);
    values.set("a", '{"version":1,"entries":[{"receipt":{"prompt":"PRIVATE"}}]}');
    await expect(receipts.list()).rejects.toMatchObject({ code: "db/error" });
  } finally { get.mockRestore(); put.mockRestore(); }
});

test("late old activation callbacks cannot overwrite a reused historical request name", async () => {
  const f = storage(), old = new PluginInferenceReceipts(active(), f.adapter), next = new PluginInferenceReceipts(active(), f.adapter);
  const original = await old.begin("reused", () => {});
  for (let i = 0; i < 64; i++) { const handle = await next.begin(`new-${i}`, () => {}); await handle.finish(); await handle.settle(); }
  expect(await next.get("reused")).toBeNull();
  const replacement = await next.begin("reused", () => {});
  await original.finish(new AppError("ai/request-timeout", "old")); await original.settle();
  expect(await next.get("reused")).toMatchObject({ status: "running", requestAvailable: true, interrupted: false, attempts: [] });
  await replacement.finish(); await replacement.settle();
});
