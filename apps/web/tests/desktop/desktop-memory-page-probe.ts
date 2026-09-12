import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { MemoryPage } from "@read-aware/core";
import type { PluginDisposable, PluginListView, PluginDetailView, PluginManifest } from "@read-aware/plugin-types";
import { commitDomainEvents } from "../../src/platform/domain-events";
import { createMemoryPort } from "../../src/features/ai/agent/ports/memory-port";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { buildMemoryTools } from "../../../../packages/agent/src/tools/memory-tools";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import manifest from "../../../../plugins/memory-desk/manifest.json";

const pluginId = "capability-native-memory-page";
const owned: PluginDisposable[] = [], ids: string[] = [];
let worker: SandboxedPlugin | undefined;
let view: PluginListView | PluginDetailView | undefined;
let first: MemoryPage | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.memory-page-e2e")) throw Error("Isolated memory-page-e2e profile required");
}
function summary() {
  if (!view) throw Error("Open Memory Desk first");
  return view.kind === "list" ? { kind: view.kind, ids: view.items.map(item => item.id), page: view.pagination?.page, pageCount: view.pagination?.pageCount,
    hasNext: !!view.pagination?.onNext } : { kind: view.kind, content: view.content, actions: view.actions?.map(action => action.id) };
}
export async function prepareMemoryPageProbe() {
  await isolated();
  if (worker || ids.length) throw Error("Probe already prepared");
  for (let index = 0; index < 105; index++) ids.push(crypto.randomUUID());
  await commitDomainEvents(...ids.map((memoryId, index) => ({ type: "memory.promoted", origin: "user", payload: {
    memoryId, kind: "fact", scope: "user", content: `Native pagination evidence ${String(index).padStart(3, "0")}`, importance: index / 105,
  } })) as Parameters<typeof commitDomainEvents>);
  worker = await startPluginWorker({ ...manifest, id: pluginId } as PluginManifest, "0.5.4", owned,
    { moduleUrl: new URL("../../../../plugins/memory-desk/dist/main.js", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === pluginId && item.id === "open")!;
  const root = (await command.run())!.view as PluginListView;
  view = (await root.items.find(item => item.id === "user")!.onSelect!())!.view as PluginListView;
  first = await createMemoryPort().pageMemories({ scopes: ["user"], limit: 20 });
  return { seedCount: ids.length, nativeTotal: first.total, revision: first.revision, desk: summary() };
}
export async function memoryPageNext() {
  await isolated();
  if (view?.kind !== "list" || !view.pagination?.onNext) throw Error("No next page");
  view = (await view.pagination.onNext())!.view as PluginListView | PluginDetailView;
  return summary();
}
export async function memoryPageChange() {
  await isolated(); if (!ids[0] || !first) throw Error("Prepare first");
  await commitDomainEvents({ type: "memory.revised", origin: "user", payload: { memoryId: ids[0], content: "Native pagination evidence changed outside first page" } });
  let nativeError: string | undefined;
  try { await createMemoryPort().pageMemories({ scopes: ["user"], offset: 20, expectedRevision: first.revision }); }
  catch (error) { nativeError = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown"; }
  return { nativeError };
}
export async function memoryPageRefresh() {
  await isolated();
  const refresh = view?.actions?.find(action => action.id === "refresh");
  if (!refresh) throw Error("No refresh action");
  view = (await refresh.run())!.view as PluginListView;
  return summary();
}
export async function memoryPageShow() {
  await isolated();
  await runPluginContribution(pluginId, manifest.name, async () => ({ view }), { presentation: "dialog" });
  return summary();
}
export async function memoryPageAgent() {
  await isolated();
  const tool = buildMemoryTools({ kind: "global", threadId: "native-memory-page-probe" }, buildRuntimeDeps()).find(item => item.name === "search_memory")!;
  const query = async (input: unknown): Promise<MemoryPage> => {
    const result = await tool.execute("native-page", input);
    if (result.content[0]?.type !== "text") throw Error("Expected page result");
    return JSON.parse(result.content[0].text);
  };
  const a = await query({ query: "pagination", limit: 100 });
  const b = await query({ query: "pagination", offset: a.nextOffset, expectedRevision: a.revision, limit: 100 });
  return { first: a.items.length, second: b.items.length, total: a.total, unique: new Set([...a.items, ...b.items].map(item => item.id)).size,
    exhausted: b.nextOffset === null, revision: a.revision, sameRevision: a.revision === b.revision };
}
export async function cleanupMemoryPageProbe() {
  await isolated(); await worker?.terminate(); worker = undefined;
  for (const item of owned.splice(0).reverse()) item.dispose();
  await commitDomainEvents(...ids.splice(0).map(memoryId => ({ type: "memory.forgotten", origin: "user", payload: { memoryId, reason: "user" } })) as Parameters<typeof commitDomainEvents>);
  view = undefined; first = undefined;
  return { contributions: inspectContributions(pluginId).length, active: (await createMemoryPort().pageMemories({ scopes: ["user"] })).total };
}
