import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { installedPluginsAtom, pluginCommandsAtom, readerModesAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildPluginContext } from "../../src/features/plugins/runtime/plugin-context";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";
import { readingRuntime } from "../../src/domain/reading-runtime";
import type { ReadingModeConfiguration } from "@read-aware/core";
import { buildReaderTools } from "../../../../packages/agent/src/tools/reader-tools";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";

const id = "capability-segmentation-probe";
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
let restoreSentenceReader = false;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareSegmentationProbe(keepSentenceReader = false) {
  const dataDir = await isolated();
  if (worker) throw new Error("Clean up the existing probe first");
  restoreSentenceReader = !keepSentenceReader && getDefaultStore().get(installedPluginsAtom).some(plugin => plugin.manifest.id === "sentence-reader" && plugin.enabled);
  if (restoreSentenceReader) await setPluginEnabled("sentence-reader", false);
  const manifest: PluginManifest = { id, name: "Segmentation diagnostic", version: "1.0.0", schemaVersion: 1, permissions: ["reader:modes"],
    requires: { contributions: { readerModes: "^1.1.0", commands: "^1.0.0" } } };
  try {
    worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./segmentation-probe.ts", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    return { dataDir, restoreSentenceReader, modes: getDefaultStore().get(readerModesAtom).map(mode => mode.key) };
  } catch (error) { await cleanupSegmentationProbe(); throw error; }
}
export async function segmentationBehavior(behavior: "slow" | "reject") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === behavior);
  if (!command) throw new Error("Probe command unavailable");
  await command.run();
}
export async function segmentationSnapshot() {
  await isolated();
  return readingRuntime.snapshot();
}
let modeAbort: AbortController | undefined;
export async function agentMode(input: ReadingModeConfiguration) {
  await isolated();
  const bookId = readingRuntime.snapshot().bookId;
  if (!bookId) throw new Error("Open the synthetic reading probe book first");
  const abort = new AbortController(); modeAbort = abort;
  const tool = buildReaderTools({ kind: "book", bookId }, buildRuntimeDeps()).find(tool => tool.name === "configure_reading_mode")!;
  try { return await tool.execute("mode-e2e", input, abort.signal); }
  finally { if (modeAbort === abort) modeAbort = undefined; }
}
export async function cancelAgentMode() {
  await isolated(); modeAbort?.abort(new Error("Mode diagnostic cancelled"));
}
/** Plugin-path actor for reading mode commands: a real in-page plugin context with reading:write, no compiled UI in between. */
let readingActor: ReturnType<typeof buildPluginContext> | undefined;
function readingCommands() {
  if (!readingActor) {
    readingActor = buildPluginContext({ id: "capability-segmentation-reading", name: "Segmentation reading actor", version: "1.0.0", schemaVersion: 1,
      permissions: ["reading:write"], requires: { domains: { reading: "^2.22.0" } } }, "0.5.4", disposables);
    readingActor.lifecycle.promote();
  }
  const reading = readingActor.context.domains.reading;
  if (!reading?.commands) throw new Error("Reading actor lacks reading:write");
  return { queries: reading.queries, commands: reading.commands };
}
async function modeGuard() {
  const reading = readingCommands();
  const session = await reading.queries.session();
  return { reading, session, guard: { sessionId: session.sessionId ?? undefined, bookId: session.bookId ?? undefined } };
}
export async function pluginMode(active: boolean, unitId: string) {
  await isolated();
  const { reading, session, guard } = await modeGuard();
  if (!session.mode.modeKey) throw new Error("No reading mode is selected");
  await reading.commands.configureMode({ active, unitId, modeKey: session.mode.modeKey }, guard);
  return readingRuntime.snapshot();
}
export async function pluginSelectMode(selectModeKey: string) {
  await isolated();
  const { reading, session, guard } = await modeGuard();
  await reading.commands.configureMode({ active: session.mode.requestedActive, modeKey: session.mode.modeKey ?? undefined, selectModeKey }, guard);
  return readingRuntime.snapshot();
}
export async function closeProbeBook() {
  await isolated(); await readingRuntime.close(); return readingRuntime.snapshot();
}
export async function modeNavigation(action: "return-to-unit" | "away" | "next-unit" | "previous-unit", fraction = 0.8) {
  await isolated();
  const bookId = readingRuntime.snapshot().bookId;
  if (!bookId) throw new Error("Open the synthetic reading probe book first");
  const tools = buildReaderTools({ kind: "book", bookId }, buildRuntimeDeps());
  const abort = new AbortController(); modeAbort = abort;
  try {
    return action === "away" ? await tools.find(tool => tool.name === "open_book")!.execute("mode-e2e", { fraction }, abort.signal)
      : await tools.find(tool => tool.name === "navigate_reading")!.execute("mode-e2e", { action }, abort.signal);
  } finally { if (modeAbort === abort) modeAbort = undefined; }
}
export async function pluginUnitStep(direction: "next" | "previous") {
  await isolated();
  const { reading, guard } = await modeGuard();
  const result = await reading.commands.stepMode(direction, guard);
  return { outcome: result.outcome, snapshot: readingRuntime.snapshot() };
}
export async function pluginReturnToUnit() {
  await isolated();
  const { reading, guard } = await modeGuard();
  await reading.commands.returnToMode(guard);
  return readingRuntime.snapshot();
}
export async function cleanupSegmentationProbe() {
  await isolated();
  await worker?.terminate(); worker = undefined;
  if (readingActor) { readingActor.lifecycle.stop(); await readingActor.lifecycle.drainCleanups(); readingActor = undefined; }
  for (const disposable of disposables.reverse()) disposable.dispose(); disposables = [];
  if (restoreSentenceReader) { await setPluginEnabled("sentence-reader", true); restoreSentenceReader = false; }
  return { remainingCommands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === id).length,
    remainingModes: getDefaultStore().get(readerModesAtom).filter(mode => mode.pluginId === id).length };
}
