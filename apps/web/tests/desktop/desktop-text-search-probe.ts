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
import { seedTextStateBooks, extractRealTextProbe, cleanupTextStateProbe, startTextDeskProbe } from "./desktop-text-state-probe";
import { registerActiveBookContent, withBookContent } from "../../src/features/library/lib/book-content-source";
import { retainBook } from "../../src/features/reader/lib/book-lifetime";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import textDeskManifest from "../../../../plugins/text-desk/manifest.json";

const workers = new Map<string, SandboxedPlugin>();
const disposables: PluginDisposable[] = [];
let books: Record<string, string> = {};
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
  await startTextDeskProbe();
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
  return { ...cleanup, sourceError, shutdownErrors: shutdown.flatMap(result => result.status === "rejected" ? [String(result.reason)] : []),
    searchContributions: ids.reduce((count, id) => count + inspectContributions(id).length, 0) };
}

/** Real imported parser and compiled Worker; only the section read timing is held. */
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
  const id = "capability-search-lifecycle-desk";
  const worker = await startPluginWorker({ ...textDeskManifest, id } as PluginManifest, "0.5.4", disposables,
    { moduleUrl: new URL("../../../../plugins/text-desk/dist/main.js", import.meta.url).href });
  workers.set(id, worker); await worker.checkHealth(); worker.promote();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === "open")!;
  await runPluginContribution(id, "Text Desk search lifecycle", command.run, { presentation: "dialog", owner: command.run });
  return { ...seed, pluginId: id };
}

export async function textSearchLifecycleStatus(releaseRead = false) {
  await isolated();
  if (!heldSearch) throw Error("No owned search lifecycle probe");
  if (releaseRead) heldSearch.release();
  return { entered: heldSearch.entered, returned: heldSearch.returned,
    textState: await getBookTextSnapshot(books.normal!) };
}
