import { getDefaultStore } from "jotai";
import type {
  PluginAction,
  PluginDisposable,
  PluginFormView,
  PluginListView,
  PluginManifest,
  PluginView,
  PluginViewContent,
  PluginViewResult,
} from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../src/domain/library";
import { createReadingDomain } from "../../src/domain/reading";
import type { FoliateBook } from "../../src/features/reader/lib/foliate-engine";
import { retainBook } from "../../src/features/reader/lib/book-lifetime";
import { registerActiveBookContent, withBookContent } from "../../src/features/library/lib/book-content-source";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { releasePluginCallbacks } from "../../src/features/plugins/runtime/plugin-callback-wire";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { PluginViewSession } from "../../src/features/plugins/lib/plugin-view-session";
import type { RegisteredCommand } from "../../src/features/plugins/lib/plugin-types";
import jumperManifest from "../../../../plugins/jumper/manifest.json";
import textDeskManifest from "../../../../plugins/text-desk/manifest.json";
import { assertFull2BookAccessProfile } from "./desktop-book-access-fixture";

/**
 * D3 exercises the compiled first-party consumers through the host Worker
 * boundary. It owns only the temporary result-limit book; the two Full2 books
 * are supplied by the acceptance profile and are never removed here.
 */
const SEARCH_QUERY = "Full2 access probe";
const RESULT_QUERY = "d3-bounded-token";
const RESULT_FIXTURE_HITS = 205;
const RESULT_LIMIT = 200;
const WAIT_MS = 12_000;
const FULL2_FILE_PREFIX = "full2-book-access-";

const library = createLibraryDomain("user");
const reading = createReadingDomain("user");
const workers = new Map<string, SandboxedPlugin>();
const disposables: PluginDisposable[] = [];

type ProbeFixture = {
  profile: string;
  firstBookId: string;
  secondBookId: string;
  resultBookId: string;
  originalBookId?: string;
  workerIds: { jumper: string; textDesk: string };
};

let fixture: ProbeFixture | undefined;
let runRecord: ProbeRunRecord | undefined;

type ParserGate = {
  entered: number;
  returned: number;
  release: () => void;
  finish: () => void;
  task: Promise<void>;
};

type WatchedView = {
  session: PluginViewSession;
  views: PluginViewContent[];
  dispose: () => void;
};

type ProbeRunRecord = {
  fixtureId: string;
  completed: Record<string, unknown>;
  budget: Record<string, unknown>;
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(check: () => boolean, label: string, timeout = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  throw new Error(`${label} did not settle within ${timeout}ms`);
}

function requireView(result: PluginViewResult, label: string): PluginView {
  if (!result || typeof result !== "object" || !result.view) throw new Error(`${label} returned no view`);
  return result.view;
}

function findForm(value: unknown): PluginFormView | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    kind?: unknown;
    fields?: unknown;
    onSubmit?: unknown;
    blocks?: unknown;
    cells?: unknown;
    block?: unknown;
  };
  if (candidate.kind === "form" && Array.isArray(candidate.fields) && typeof candidate.onSubmit === "function") {
    return value as PluginFormView;
  }
  if (Array.isArray(candidate.blocks)) {
    for (const block of candidate.blocks) {
      const form = findForm(block);
      if (form) return form;
    }
  }
  if (Array.isArray(candidate.cells)) {
    for (const cell of candidate.cells) {
      const form = findForm(cell);
      if (form) return form;
    }
  }
  return candidate.block === undefined ? undefined : findForm(candidate.block);
}

function findAction(view: PluginView, id: string): PluginAction {
  if (view.kind !== "detail") throw new Error(`Expected detail view for ${id}`);
  const action = view.actions?.find(item => item.id === id);
  if (!action) throw new Error(`Detail view has no ${id} action`);
  return action;
}

function watchView(view: PluginView): WatchedView {
  const views: PluginViewContent[] = [];
  const session = new PluginViewSession();
  const record = () => {
    const current = session.getSnapshot().stack.at(-1);
    if (current) views.push(current);
  };
  const unsubscribe = session.subscribe(record);
  session.setRoot(view);
  record();
  return {
    session,
    views,
    dispose: () => {
      session.dispose("unmounted");
      unsubscribe();
    },
  };
}

function currentView(watched: WatchedView): PluginViewContent | undefined {
  return watched.session.getSnapshot().stack.at(-1);
}

function progressWasPublished(views: readonly PluginViewContent[]): boolean {
  return views.some(view => {
    if (view.kind !== "blocks") return false;
    const progress = view.blocks.find(block => block.kind === "progress");
    return !!progress && (progress.value !== null || progress.max !== undefined || progress.label?.includes("/"));
  });
}

function resultList(watched: WatchedView, label: string): PluginListView {
  const view = currentView(watched);
  if (!view || view.kind !== "list") throw new Error(`${label} did not publish a terminal list`);
  return view;
}

async function startWorker(manifest: PluginManifest, moduleUrl: string): Promise<string> {
  const id = `${manifest.id}-d3-${crypto.randomUUID()}`;
  const worker = await startPluginWorker({ ...manifest, id } as PluginManifest, "0.5.4", disposables, { moduleUrl });
  workers.set(id, worker);
  await worker.checkHealth();
  worker.promote();
  return id;
}

async function commandFor(pluginId: string, commandId: string) {
  let command: RegisteredCommand | undefined;
  await waitUntil(() => {
    const found = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === pluginId && item.id === commandId);
    if (!found || found.state?.enabled === false) return false;
    command = found;
    return true;
  }, `Worker command ${pluginId}:${commandId}`);
  if (!command) throw new Error(`Worker command ${pluginId}:${commandId} is unavailable`);
  return command;
}

async function jumperSearch(bookId: string, query: string, matchCase = false, wholeWords = false): Promise<PluginView> {
  if (!fixture) throw new Error("Prepare the bounded search probe first");
  if ((await reading.queries.session()).bookId !== bookId) throw new Error("Jumper search book is not the active Full2 book");
  const command = await commandFor(fixture.workerIds.jumper, "open");
  const rootResult = await command.run();
  try {
    const form = findForm(requireView(rootResult, "Jumper open command"));
    if (!form) throw new Error("Jumper open view has no search form");
    const result = await form.onSubmit({ mode: "text", query, matchCase, wholeWords });
    return requireView(result, "Jumper text search");
  } finally {
    releasePluginCallbacks(rootResult);
  }
}

async function textDeskSearch(bookId: string, query: string, matchCase = false, wholeWords = false): Promise<PluginView> {
  if (!fixture) throw new Error("Prepare the bounded search probe first");
  const command = await commandFor(fixture.workerIds.textDesk, "open");
  const rootResult = await command.run();
  try {
    const root = requireView(rootResult, "Text Desk open command");
    if (root.kind !== "list") throw new Error("Text Desk open view is not a book list");
    const item = root.items.find(candidate => candidate.id === bookId);
    if (!item?.onSelect) throw new Error(`Text Desk book ${bookId} is not on the first page`);
    const detailResult = await item.onSelect();
    try {
      const detail = requireView(detailResult, "Text Desk book detail");
      const actionResult = await findAction(detail, "find-passage").run();
      try {
        const form = requireView(actionResult, "Text Desk passage form");
        if (form.kind !== "form") throw new Error("Text Desk passage form is not a form view");
        const result = await form.onSubmit({ query, matchCase, wholeWords });
        return requireView(result, "Text Desk range search");
      } finally {
        releasePluginCallbacks(actionResult);
      }
    } finally {
      releasePluginCallbacks(detailResult);
    }
  } finally {
    releasePluginCallbacks(rootResult);
  }
}

async function searchView(consumer: "jumper" | "textDesk", bookId: string, query: string,
  matchCase = false, wholeWords = false): Promise<PluginView> {
  return consumer === "jumper"
    ? jumperSearch(bookId, query, matchCase, wholeWords)
    : textDeskSearch(bookId, query, matchCase, wholeWords);
}

/** Holds the real Foliate parser at section read, as the text-search driver does. */
async function holdParserRead(bookId: string): Promise<ParserGate> {
  let releaseGate!: () => void;
  let finishLifetime!: () => void;
  let markReady!: () => void;
  const gate = new Promise<void>(resolve => { releaseGate = resolve; });
  const lifetime = new Promise<void>(resolve => { finishLifetime = resolve; });
  const ready = new Promise<void>(resolve => { markReady = resolve; });
  const state: ParserGate = { entered: 0, returned: 0, release: releaseGate, finish: finishLifetime, task: Promise.resolve() };
  state.task = withBookContent(bookId, undefined, undefined, async ({ book, contentVersion }) => {
    if (!book.sections.some(section => section.getText || section.createDocument)) {
      throw new Error("Full2 TXT parser has no section reader");
    }
    const releaseParser = retainBook(book);
    const readAfterGate = async <T>(read: () => T | Promise<T>): Promise<T> => {
      state.entered++;
      await gate;
      const value = await read();
      state.returned++;
      return value;
    };
    const held = {
      ...book,
      sections: book.sections.map(section => ({
        ...section,
        ...(section.getText ? { getText: () => readAfterGate(() => section.getText!()) }
          : section.createDocument ? { createDocument: () => readAfterGate(() => section.createDocument!()) } : {}),
      })),
      destroy: releaseParser,
    } as FoliateBook;
    const releaseOwner = retainBook(held);
    const unregister = registerActiveBookContent(bookId, held, contentVersion);
    markReady();
    try {
      await lifetime;
    } finally {
      unregister();
      await releaseOwner();
    }
  });
  await Promise.race([ready, state.task.then(() => { throw new Error("Parser gate closed before registration"); })]);
  return state;
}

async function assertProgressAndResult(consumer: "jumper" | "textDesk", bookId: string) {
  const view = await searchView(consumer, bookId, SEARCH_QUERY);
  const watched = watchView(view);
  try {
    await waitUntil(() => currentView(watched)?.kind === "list", `${consumer} result`);
    const list = resultList(watched, `${consumer} result`);
    if (!progressWasPublished(watched.views)) throw new Error(`${consumer} did not publish page progress before result`);
    if (!list.items.length) throw new Error(`${consumer} returned no Full2 search hit`);
    return { status: "completed", progress: true, hits: list.items.length, title: list.title ?? "" };
  } finally {
    watched.dispose();
    releasePluginCallbacks(view);
  }
}

async function assertCancelReplace(consumer: "jumper" | "textDesk", bookId: string) {
  const gate = await holdParserRead(bookId);
  let cancelledView: PluginView | undefined;
  let cancelled: WatchedView | undefined;
  try {
    cancelledView = await searchView(consumer, bookId, SEARCH_QUERY);
    cancelled = watchView(cancelledView);
    await waitUntil(() => gate.entered > 0, `${consumer} parser read admission`);
    cancelled.session.dispose("replaced");
    gate.release();
    gate.finish();
    await gate.task;
    await delay(100);
    if (cancelled.views.some(view => view.kind === "list")) {
      throw new Error(`${consumer} published a late result after cancellation`);
    }
  } finally {
    cancelled?.dispose();
    if (cancelledView) releasePluginCallbacks(cancelledView);
    if (gate.entered && gate.returned === 0) gate.release();
    gate.finish();
    await gate.task.catch(() => undefined);
  }

  const replacement = await searchView(consumer, bookId, SEARCH_QUERY);
  const replaced = watchView(replacement);
  try {
    await waitUntil(() => currentView(replaced)?.kind === "list", `${consumer} replacement result`);
    const list = resultList(replaced, `${consumer} replacement result`);
    if (!list.items.length) throw new Error(`${consumer} replacement returned no hit`);
    return { cancelled: true, stalePublished: false, replacementHits: list.items.length };
  } finally {
    replaced.dispose();
    releasePluginCallbacks(replacement);
  }
}

async function assertResultLimit(consumer: "jumper" | "textDesk", bookId: string) {
  const view = await searchView(consumer, bookId, RESULT_QUERY, true, true);
  const watched = watchView(view);
  try {
    await waitUntil(() => currentView(watched)?.kind === "list", `${consumer} result-limit result`);
    const list = resultList(watched, `${consumer} result-limit result`);
    if (list.items.length !== RESULT_LIMIT) {
      throw new Error(`${consumer} expected ${RESULT_LIMIT} retained hits, got ${list.items.length}`);
    }
    if (!list.title || list.title === RESULT_QUERY || !list.actions?.some(action => action.id === "retry")) {
      throw new Error(`${consumer} did not expose a visible result-limit terminal state`);
    }
    return { status: "result-limit", progress: progressWasPublished(watched.views), hits: list.items.length, title: list.title };
  } finally {
    watched.dispose();
    releasePluginCallbacks(view);
  }
}

async function runBudgetStage(record: ProbeRunRecord) {
  if (!fixture) throw new Error("Prepare the bounded search probe first");
  for (const consumer of ["jumper", "textDesk"] as const) {
    if (Object.hasOwn(record.budget, consumer)) continue;
    await reading.commands.openBook(fixture.resultBookId, AbortSignal.timeout(20_000));
    record.budget[consumer] = await assertResultLimit(consumer, fixture.resultBookId);
  }
}

/** Prepare the Full2-only driver and start the actual compiled plugin Workers. */
export async function prepareDesktopBoundedSearchProbe() {
  if (fixture) throw new Error("Clean up the previous bounded search probe first");
  const profile = await assertFull2BookAccessProfile();
  const before = await reading.queries.session();
  const books = (await library.queries.books.list())
    .filter(book => book.fileName?.toLowerCase().startsWith(FULL2_FILE_PREFIX) && book.fileName?.toLowerCase().endsWith(".txt"))
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  if (books.length !== 2) throw new Error(`Full2 bounded search requires exactly two fixture TXT books, found ${books.length}`);

  // Plain-text paragraphs are concatenated by Foliate's text index. A
  // sentence boundary keeps each repeated token a separate whole word.
  const resultData = Array.from({ length: RESULT_FIXTURE_HITS }, (_, index) => `${RESULT_QUERY} ${index}.\n`).join("");
  const resultBook = await library.commands.books.importBook({
    fileName: `d3-bounded-search-${crypto.randomUUID()}.txt`,
    data: new TextEncoder().encode(resultData),
  });
  fixture = {
    profile,
    firstBookId: books[0]!.id,
    secondBookId: books[1]!.id,
    resultBookId: resultBook.id,
    originalBookId: before.bookId ?? undefined,
    workerIds: { jumper: "", textDesk: "" },
  };
  runRecord = { fixtureId: resultBook.id, completed: {}, budget: {} };
  try {
    await reading.commands.openBook(fixture.firstBookId, AbortSignal.timeout(20_000));
    fixture.workerIds.jumper = await startWorker(jumperManifest as PluginManifest,
      new URL("../../../../plugins/jumper/dist/main.js", import.meta.url).href);
    fixture.workerIds.textDesk = await startWorker(textDeskManifest as PluginManifest,
      new URL("../../../../plugins/text-desk/dist/main.js", import.meta.url).href);
    await commandFor(fixture.workerIds.jumper, "open");
    await commandFor(fixture.workerIds.textDesk, "open");
    return {
      profile,
      full2Books: [fixture.firstBookId, fixture.secondBookId],
      resultBookId: fixture.resultBookId,
      resultFixtureHits: RESULT_FIXTURE_HITS,
      resultLimit: RESULT_LIMIT,
      workerIds: fixture.workerIds,
      compiledModules: {
        jumper: "plugins/jumper/dist/main.js",
        textDesk: "plugins/text-desk/dist/main.js",
      },
    };
  } catch (error) {
    await cleanupDesktopBoundedSearchProbe();
    throw error;
  }
}

/** Run progress/result, cancellation/replacement, and non-empty budget checks. */
export async function runDesktopBoundedSearchProbe() {
  await assertFull2BookAccessProfile();
  if (!fixture || !fixture.workerIds.jumper || !fixture.workerIds.textDesk) {
    throw new Error("Prepare the bounded search probe first");
  }
  const record = runRecord ??= { fixtureId: fixture.resultBookId, completed: {}, budget: {} };
  for (const consumer of ["jumper", "textDesk"] as const) {
    if (Object.hasOwn(record.completed, consumer)) continue;
    await reading.commands.openBook(fixture.firstBookId, AbortSignal.timeout(20_000));
    record.completed[consumer] = {
      ...(await assertProgressAndResult(consumer, fixture.firstBookId)),
      ...(await assertCancelReplace(consumer, fixture.firstBookId)),
    };
  }
  await runBudgetStage(record);
  return {
    profile: fixture.profile,
    completed: record.completed,
    budget: record.budget,
    resultFixtureHits: RESULT_FIXTURE_HITS,
    resultLimit: RESULT_LIMIT,
  };
}

/** Resume only the budget stage after completed consumer evidence is recorded. */
export async function runDesktopBoundedSearchBudgetProbe() {
  await assertFull2BookAccessProfile();
  if (!fixture || !fixture.workerIds.jumper || !fixture.workerIds.textDesk) {
    throw new Error("Prepare the bounded search probe first");
  }
  const record = runRecord ??= { fixtureId: fixture.resultBookId, completed: {}, budget: {} };
  await runBudgetStage(record);
  return {
    profile: fixture.profile,
    completed: record.completed,
    budget: record.budget,
    resultFixtureHits: RESULT_FIXTURE_HITS,
    resultLimit: RESULT_LIMIT,
  };
}

/** Read partial stage results after a later consumer assertion fails. */
export function desktopBoundedSearchProbeProgress() {
  if (!runRecord) return null;
  return {
    fixtureId: runRecord.fixtureId,
    completed: { ...runRecord.completed },
    budget: { ...runRecord.budget },
  };
}

/** Stop Workers and remove only the result-limit fixture created by prepare. */
export async function cleanupDesktopBoundedSearchProbe() {
  await assertFull2BookAccessProfile();
  const current = fixture;
  if (!current) return { removed: [], contributions: {} };
  const errors: string[] = [];
  for (const [id, worker] of workers) {
    try { await worker.terminate(); } catch (error) { errors.push(`${id}: ${String(error)}`); }
  }
  workers.clear();
  for (const disposable of disposables.splice(0).reverse()) {
    try { disposable.dispose(); } catch (error) { errors.push(`disposable: ${String(error)}`); }
  }
  try {
    if (current.originalBookId) await reading.commands.openBook(current.originalBookId, AbortSignal.timeout(20_000));
    else await reading.commands.close();
  } catch (error) { errors.push(`restore reader: ${String(error)}`); }
  try {
    if (await library.queries.books.get(current.resultBookId)) {
      const removal = await library.commands.books.removeMany([current.resultBookId]);
      let release = removal.files;
      if (release.status === "pending") release = (await library.commands.books.retryRemovalCleanup([current.resultBookId])).files;
      if (release.status === "pending") throw new Error(`result fixture file cleanup is pending: ${release.errorCode}`);
    }
  } catch (error) { errors.push(`remove result fixture: ${String(error)}`); }
  const contributions = Object.fromEntries(Object.values(current.workerIds).map(id => [id, inspectContributions(id).length]));
  if (Object.values(contributions).some(count => count !== 0)) errors.push("Worker contributions remained after cleanup");
  fixture = undefined;
  if (errors.length) throw new AggregateError(errors.map(error => new Error(error)), "Bounded search probe cleanup failed");
  return { removed: [current.resultBookId], contributions };
}
