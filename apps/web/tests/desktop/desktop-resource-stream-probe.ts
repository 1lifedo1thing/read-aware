import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { errorCode } from "@read-aware/core";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { resourceAdapter } from "../../src/services/resources";
import { nativeResourceFiles } from "../../src/platform/resource-files";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { parseProbeToast } from "./probe-toast";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { buildResourceTools } from "../../../../packages/agent/src/tools/resource-tools";

/** Exercises real Worker structured-clone and native temporary files, without replacing I/O. */
export async function runResourceStreamProbe() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e profile required");
  const disposables: PluginDisposable[] = [], workers: Awaited<ReturnType<typeof startPluginWorker>>[] = [];
  const nativeIds: string[] = [], originalCreate = resourceAdapter.create;
  resourceAdapter.create = async options => {
    const value = await originalCreate(options);
    if (options.name.startsWith("resource79-")) nativeIds.push(value.id);
    return value;
  };
  const command = async (pluginId: string, id: string) => {
    const item = getDefaultStore().get(pluginCommandsAtom).find(value => value.pluginId === pluginId && value.id === id);
    if (!item) throw Error(`Missing ${pluginId}/${id}`);
    const result = await item.run();
    return parseProbeToast(result!.toast!);
  };
  const start = async (id: string, description = "") => {
    const worker = await startPluginWorker({ id, name: id, description, version: "1.0.0", schemaVersion: 1,
      requires: { services: { resources: "^1.0.0" } } }, "0.5.4", disposables,
      { moduleUrl: new URL("./resource-stream-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote(); return worker;
  };
  const observations: Record<string, unknown> = {};
  try {
    await start("resource-stream-79-a");
    const write = await command("resource-stream-79-a", "write") as { resource: { id: string } };
    observations.write = write;
    await start("resource-stream-79-b", write.resource.id);
    observations.foreign = await command("resource-stream-79-b", "foreign");
    observations.read = await command("resource-stream-79-a", "read");
    observations.quotaAndAbort = await command("resource-stream-79-a", "quotaAndAbort");
    observations.abandoned = await command("resource-stream-79-a", "leaveOpen");
  } finally {
    try {
      const failures: unknown[] = [];
      for (const worker of workers.reverse()) {
        try { await worker.terminate(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Resource probe Worker cleanup failed");
    }
    finally {
      for (const disposable of disposables.reverse()) disposable.dispose();
      resourceAdapter.create = originalCreate;
    }
  }
  const released = [];
  for (const id of nativeIds) {
    let code = "accepted";
    try { await nativeResourceFiles.read(id, 0, 1); } catch (error) { code = errorCode(error) ?? "unknown"; }
    if (code !== "fs/not-found") throw Error(`Native file survived Worker retirement: ${code}`);
    released.push(code);
  }
  return { ...observations, nativeFiles: nativeIds.length, nativeReleased: released, remainingCommands: getDefaultStore().get(pluginCommandsAtom).filter(value => value.pluginId.startsWith("resource-stream-79-")).length };
}

/** Host-seeded fixtures exercise actual Agent tools and native UTF-8 byte cursors. */
export async function runAgentResourceTextProbe() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e profile required");
  const deps = buildRuntimeDeps(), threadId = `resource-text-79-${crypto.randomUUID()}`;
  const scope = { kind: "global" as const, threadId };
  const owner = deps.resources(`global:${threadId}`);
  const tools = buildResourceTools(scope, deps);
  const foreign = buildResourceTools({ kind: "global", threadId: `${threadId}-foreign` }, deps);
  const ids: string[] = [];
  const invoke = async (name: string, params: unknown, useForeign = false) => {
    const result = await (useForeign ? foreign : tools).find(tool => tool.name === name)!.execute("resource79", params);
    return JSON.parse(result.content.filter(item => item.type === "text").map(item => item.text).join(""));
  };
  const failure = async (run: () => Promise<unknown>) => {
    try { await run(); return "accepted"; } catch (error) { return errorCode(error) ?? "unknown"; }
  };
  const create = async (data: Uint8Array) => {
    const value = await owner.create({ name: "resource79-text.txt", mimeType: "text/plain" });
    ids.push(value.id); await owner.append(value.id, 0, data); await owner.commit(value.id); return value.id;
  };
  try {
    const expected = "\uFEFFA中🙂e\u0301文Z", bytes = new TextEncoder().encode(expected), id = await create(bytes);
    const chunks: { text: string; nextOffset: number; eof: boolean }[] = [];
    let offset = 0, text = "";
    do {
      const result = await invoke("read_resource_text", { id, offset, length: 4 });
      if (result.nextOffset <= offset) throw Error("UTF-8 cursor stalled");
      chunks.push(result); text += result.text; offset = result.nextOffset;
      if (result.eof) break;
    } while (chunks.length < 20);
    if (text !== expected || offset !== bytes.length || !chunks.at(-1)?.eof) throw Error("UTF-8 roundtrip changed bytes or code points");
    const midCodePoint = await failure(() => invoke("read_resource_text", { id, offset: 5, length: 4 }));
    const crossThread = await failure(() => invoke("read_resource_text", { id, length: 4 }, true));
    const rejected = [];
    for (const data of [new Uint8Array([65, 0, 66]), new Uint8Array([0xc3, 0x28]), new Uint8Array([0xe2, 0x82])]) {
      const bad = await create(data);
      rejected.push(await failure(() => invoke("read_resource_text", { id: bad, length: 4 })));
    }
    const original = await owner.openBook("07ef226e-1ebc-47b6-8dc9-d09109448d22");
    if (!original) throw Error("Existing synthetic baseline book missing");
    ids.push(original.id);
    const originalExportOnly = await failure(() => invoke("read_resource_text", { id: original.id, length: 4 }));
    const release = await invoke("release_resource", { id });
    const repeatRelease = await invoke("release_resource", { id });
    const afterRelease = await failure(() => invoke("read_resource_text", { id, length: 4 }));
    if (midCodePoint !== "ui/invalid-target" || crossThread !== "fs/not-found" || rejected.some(code => code !== "ui/invalid-target") || originalExportOnly !== "memory/forbidden" || afterRelease !== "fs/not-found") throw Error("Agent resource guard failed");
    return { byteLength: bytes.length, chunks, reconstructed: text, midCodePoint, crossThread,
      binaryInvalidTruncated: rejected, originalExportOnly, release, repeatRelease, afterRelease };
  } finally {
    const results = await Promise.allSettled(ids.map(id => owner.release(id)));
    if (results.some(result => result.status === "rejected")) throw Error("Agent resource fixture cleanup failed");
  }
}
