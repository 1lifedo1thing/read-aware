import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildBookTextTools } from "../../../../packages/agent/src/tools/book-text-tools";
import { createAgentTurnState } from "../../../../packages/agent/src/tools/turn-state";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { getBookTextSnapshot } from "../../src/features/library/lib/book-text-store";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { seedTextStateBooks, extractRealTextProbe, cleanupTextStateProbe } from "./desktop-text-state-probe";
import { registerActiveBookContent, withBookContent } from "../../src/features/library/lib/book-content-source";
import { retainBook } from "../../src/features/reader/lib/book-lifetime";
import { getDesktopBlob, getDesktopBlobInfo, putDesktopBlob } from "../../src/platform/blob-store";

const workers = new Map<string, SandboxedPlugin>();
const disposables: PluginDisposable[] = [];
let books: Record<string, string> = {};
let originalSource: Uint8Array | undefined;
let heldSearch: { entered: number; returned: number; release: () => void; finish: () => void; task: Promise<void> } | undefined;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}

export async function startTextSearchProbe() {
  await isolated();
  const seed = await seedTextStateBooks(); books = seed.books;
  await extractRealTextProbe(books.normal!);
  const coldBefore = await getBookTextSnapshot(books.short!);
  const actors: Record<string, unknown> = {};
  for (const actor of ["empty", "read", "write"] as const) {
    const id = `capability-search-${actor}`;
    const manifest: PluginManifest = { id, name: id, description: books.normal, schemaVersion: 1, version: "1.0.0",
      permissions: actor === "empty" ? [] : [actor === "read" ? "library:read" : "library:write"], requires: { domains: { library: "^1.4.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./text-search-probe.ts", import.meta.url).href });
    workers.set(id, worker); await worker.checkHealth(); worker.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "inspect")!;
    actors[actor] = parseProbeToast((await command.run())!.toast!);
  }
  const state = createAgentTurnState(); state.spoilerFence = { throughChapterIndex: -1, readerChapterIndex: 0 };
  for (const kind of ["book", "global"] as const) {
    const scope = kind === "book" ? { kind, bookId: books.normal! } : { kind, threadId: "text-search-e2e" };
    const tool = buildBookTextTools(scope, buildRuntimeDeps(), state).find(tool => tool.name === "search_book_text")!;
    const result = await tool.execute("text-search-e2e", { queries: ["Text preparation probe"] });
    if (result.content[0]?.type !== "text") throw Error("Expected Agent text result");
    actors[`agent-${kind}`] = JSON.parse(result.content[0].text);
  }
  return { ...seed, actors, coldBefore, coldAfter: await getBookTextSnapshot(books.short!) };
}

export async function cleanupTextSearchProbe() {
  await isolated();
  let sourceError: string | undefined;
  if (heldSearch) {
    heldSearch.release(); heldSearch.finish();
    try { await heldSearch.task; }
    catch (error) { sourceError = String(error); }
    heldSearch = undefined;
  }
  const ids = [...workers.keys()];
  const shutdown = await Promise.allSettled([...workers.values()].map(worker => worker.terminate())); workers.clear();
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  const cleanup = await cleanupTextStateProbe(); books = {};
  originalSource = undefined;
  return { ...cleanup, sourceError, shutdownErrors: shutdown.flatMap(result => result.status === "rejected" ? [String(result.reason)] : []),
    searchContributions: ids.reduce((count, id) => count + inspectContributions(id).length, 0) };
}

/** Real imported parser; only the section read timing is held for the synthetic actors that follow. */
export async function startTextSearchLifecycleProbe() {
  await isolated();
  if (heldSearch || workers.size) throw Error("Clean the previous search probe first");
  const seed = await seedTextStateBooks(); books = seed.books;
  let release!: () => void, finish!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const lifetime = new Promise<void>(resolve => { finish = resolve; });
  const registered = new Promise<void>(resolve => { ready = resolve; });
  const state = { entered: 0, returned: 0, release, finish, task: Promise.resolve() };
  heldSearch = state;
  state.task = withBookContent(books.normal!, undefined, undefined, async ({ book, contentVersion }) => {
    if (!book.sections.some(section => section.getText || section.createDocument)) throw Error("Fixture parser has no section reader");
    const releaseParser = retainBook(book);
    const readAfterGate = async <T>(read: () => T | Promise<T>) => {
      state.entered++; await gate;
      const value = await read(); state.returned++; return value;
    };
    const held = { ...book, sections: book.sections.map(section => ({ ...section,
      ...(section.getText ? { getText: () => readAfterGate(() => section.getText!()) }
        : section.createDocument ? { createDocument: () => readAfterGate(() => section.createDocument!()) } : {}),
    })), destroy: releaseParser };
    const releaseOwner = retainBook(held);
    const unregister = registerActiveBookContent(books.normal!, held, contentVersion);
    ready();
    try { await lifetime; }
    finally { unregister(); await releaseOwner(); }
  });
  await Promise.race([registered, state.task]);
  return seed;
}

export async function textSearchLifecycleStatus(releaseRead = false) {
  await isolated();
  if (!heldSearch) throw Error("No owned search lifecycle probe");
  if (releaseRead) heldSearch.release();
  return { entered: heldSearch.entered, returned: heldSearch.returned,
    textState: await getBookTextSnapshot(books.normal!) };
}

/** Bounded real Worker burst against the held real parser; no mocked search result. */
export async function startTextSearchPressureProbe() {
  const seed = await startTextSearchLifecycleProbe();
  const id = "capability-search-pressure";
  const worker = await startPluginWorker({ id, name: id, description: books.normal,
    schemaVersion: 1, version: "1.0.0", permissions: ["library:read"],
    requires: { domains: { library: "^1.4.0" } } }, "0.5.4", disposables,
  { moduleUrl: new URL("./text-search-probe.ts", import.meta.url).href });
  workers.set(id, worker); await worker.checkHealth(); worker.promote();
  return { ...seed, pressurePluginId: id };
}

export async function textSearchPressureCommand(id: "pressure-start" | "pressure-cancel" | "pressure-retry" | "pressure-status") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "capability-search-pressure" && item.id === id);
  if (!command) throw Error("Pressure probe command missing");
  return parseProbeToast((await command.run())!.toast!);
}

export async function startTextSearchSourceProbe(holdReads = false) {
  await isolated();
  if (heldSearch || workers.size) throw Error("Clean the previous search probe first");
  const seed = holdReads ? await startTextSearchLifecycleProbe() : await seedTextStateBooks(); books = seed.books;
  const id = "capability-search-source";
  const worker = await startPluginWorker({ id, name: id, description: books.normal,
    schemaVersion: 1, version: "1.0.0", permissions: ["library:read"],
    requires: { domains: { library: "^1.4.0" } } }, "0.5.4", disposables,
  { moduleUrl: new URL("./text-search-probe.ts", import.meta.url).href });
  workers.set(id, worker); await worker.checkHealth(); worker.promote();
  return { ...seed, pluginId: id };
}

/** Retire the deliberately held parser so a fresh query can acquire the new source. */
export async function finishTextSearchSourceReader() {
  await isolated();
  if (!heldSearch) throw Error("No owned held reader");
  const state = heldSearch;
  state.release(); state.finish();
  let code: string | undefined;
  try { await state.task; }
  catch (error) { code = error && typeof error === "object" && "code" in error ? String(error.code) : String(error); }
  heldSearch = undefined;
  return { entered: state.entered, returned: state.returned, code };
}

export async function replaceTextSearchSource(restore = false) {
  await isolated();
  if (!books.normal || !workers.has("capability-search-source")) throw Error("No owned source probe");
  const key = `bookfile:${books.normal}`;
  originalSource ??= await getDesktopBlob(key) ?? undefined;
  if (!originalSource) throw Error("Owned source missing");
  const original = new TextDecoder().decode(originalSource);
  const changed = original.replace("Text preparation probe: this section contains enough text for the chapter index.",
    "Replacement text source: the changed text belongs to a newer revision.");
  if (changed === original) throw Error("Owned fixture content did not match");
  await putDesktopBlob(key, restore ? originalSource : new TextEncoder().encode(changed));
  return getDesktopBlobInfo(key);
}

export async function textSearchSourceCommand(id: "source-capture" | "source-stale" | "source-refresh") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "capability-search-source" && item.id === id);
  if (!command) throw Error("Source probe command missing");
  return parseProbeToast((await command.run())!.toast!);
}
