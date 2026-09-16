import { appDataDir } from "@tauri-apps/api/path";
import type { MemoryPage } from "@read-aware/core";
import { commitDomainEvents } from "../../src/platform/domain-events";
import { createMemoryPort } from "../../src/features/ai/agent/ports/memory-port";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { buildMemoryTools } from "../../../../packages/agent/src/tools/memory-tools";

/** Native memory pagination and the Agent search tool, without a plugin consumer view. */
const ids: string[] = [];
let first: MemoryPage | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.memory-page-e2e")) throw Error("Isolated memory-page-e2e profile required");
}
export async function prepareMemoryPageProbe() {
  await isolated();
  if (ids.length) throw Error("Probe already prepared");
  for (let index = 0; index < 105; index++) ids.push(crypto.randomUUID());
  await commitDomainEvents(...ids.map((memoryId, index) => ({ type: "memory.promoted", origin: "user", payload: {
    memoryId, kind: "fact", scope: "user", content: `Native pagination evidence ${String(index).padStart(3, "0")}`, importance: index / 105,
  } })) as Parameters<typeof commitDomainEvents>);
  first = await createMemoryPort().pageMemories({ scopes: ["user"], limit: 20 });
  return { seedCount: ids.length, nativeTotal: first.total, revision: first.revision, firstPage: first.items.length, nextOffset: first.nextOffset };
}
export async function memoryPageChange() {
  await isolated(); if (!ids[0] || !first) throw Error("Prepare first");
  await commitDomainEvents({ type: "memory.revised", origin: "user", payload: { memoryId: ids[0], content: "Native pagination evidence changed outside first page" } });
  let nativeError: string | undefined;
  try { await createMemoryPort().pageMemories({ scopes: ["user"], offset: 20, expectedRevision: first.revision }); }
  catch (error) { nativeError = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown"; }
  const refreshed = await createMemoryPort().pageMemories({ scopes: ["user"], limit: 20 });
  return { nativeError, revisionAdvanced: refreshed.revision !== first.revision, total: refreshed.total };
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
  await isolated();
  await commitDomainEvents(...ids.splice(0).map(memoryId => ({ type: "memory.forgotten", origin: "user", payload: { memoryId, reason: "user" } })) as Parameters<typeof commitDomainEvents>);
  first = undefined;
  return { active: (await createMemoryPort().pageMemories({ scopes: ["user"] })).total };
}
