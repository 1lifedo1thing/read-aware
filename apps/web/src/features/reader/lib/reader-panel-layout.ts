/**
 * Per-book reader panel layout — whether the contents (TOC) and notes side
 * panels are open. The reader shell remounts on every book open, so this state
 * would otherwise reset each time; persisting it (keyed by library book id, like
 * `reader-overrides`) lets a book reopen with its panels exactly as left.
 *
 * Only the docked (desktop/tablet) layout reads and writes this store. The
 * exclusive phone layout keeps its full-screen TOC/chat sheets transient in
 * `useReaderPanels`, so a phone session neither restores nor records them here.
 */

import { AppError, type ReaderPanelsView } from "@read-aware/core";
import { afterLocalKVWrites, localKV, onLocalKVChange } from "../../../platform/local-store";
import { actorFromEvent, causalActor, mergeEventCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";

/** Join only inputs that changed this committed view. Old untouched state must
 * not turn a later independent user action into a continuation of an old loop. */
export function readerPanelRenderActor(previous: ReaderPanelsView | null, next: ReaderPanelsView,
  sources: { layout: DomainActor; sizes: DomainActor; transient: DomainActor; controls: DomainActor; environment: DomainActor }): DomainActor {
  const inputs: DomainActor[] = [];
  const controlsChanged = !previous || previous.controlsVisible !== next.controlsVisible;
  if (controlsChanged) inputs.push(sources.controls);
  if (!previous || previous.layout !== next.layout) inputs.push(sources.environment);
  if (!previous || JSON.stringify(previous.sizes) !== JSON.stringify(next.sizes)) inputs.push(sources.sizes);
  // Docked TOC/chat come from the persisted layout store; every other open
  // change (popovers, and TOC/chat sheets in exclusive layout) is transient.
  const changedPanels = (["toc", "chat", "annotations", "appearance"] as const).filter(panel => !previous || previous.panels[panel].open !== next.panels[panel].open);
  const persisted = (panel: (typeof changedPanels)[number]) => (panel === "toc" || panel === "chat") && next.layout === "docked";
  if (!previous || changedPanels.some(persisted)) inputs.push(sources.layout);
  if (previous && (!controlsChanged || next.controlsVisible) && changedPanels.some(panel => !persisted(panel))) inputs.push(sources.transient);
  return actorFromEvent(mergeEventCauses(inputs.map(origin => stampEventCause({}, origin)), {}));
}

const STORAGE_KEY = "read-aware-reader-panels";

export type ReaderPanelLayout = {
  tocOpen: boolean;
  /** Whether the right-hand AI chat panel is open. */
  notesOpen: boolean;
};

export const DEFAULT_PANEL_LAYOUT: ReaderPanelLayout = {
  tocOpen: false,
  notesOpen: false,
};

type PanelLayoutStore = Record<string, ReaderPanelLayout>;

function readStore(raw: string | null): PanelLayoutStore {
  try {
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ReaderPanelLayout>>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: PanelLayoutStore = Object.create(null);
    for (const [bookId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      result[bookId] = {
        tocOpen: value.tocOpen === true,
        notesOpen: value.notesOpen === true,
      };
    }
    return result;
  } catch {
    // Malformed legacy preferences fall back to the default panel layout.
    return {};
  }
}

let renderState: { raw: string | null; origin: DomainActor } | undefined;
export const readerPanelLayoutStore = {
  getSnapshot: (): string | null => localKV.getItem(STORAGE_KEY),
  getRenderSnapshot: () => {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!renderState || raw !== renderState.raw) renderState = { raw, origin: causalActor("system") };
    return renderState;
  },
  subscribe: (listener: () => void): (() => void) => onLocalKVChange((key, raw, origin) => {
    if (key === STORAGE_KEY) { renderState = { raw, origin }; listener(); }
  }),
};

export function getReaderPanelLayout(bookId: string, raw = readerPanelLayoutStore.getSnapshot()): ReaderPanelLayout {
  const store = readStore(raw);
  const stored = Object.hasOwn(store, bookId) ? store[bookId] : undefined;
  return stored ? { ...stored } : { ...DEFAULT_PANEL_LAYOUT };
}

/** Patch settled state, preserving other books and resolving only after SQLite commits. */
export function updateReaderPanelLayout(
  bookId: string,
  update: (previous: Readonly<ReaderPanelLayout>) => ReaderPanelLayout,
  signal?: AbortSignal,
  origin: DomainActor = "user",
): Promise<ReaderPanelLayout> {
  origin = causalActor(origin);
  const work = afterLocalKVWrites(() => {
    signal?.throwIfAborted();
    if (typeof bookId !== "string" || !bookId) throw new AppError("reader/invalid-target", "Panel layout requires a book");
    const raw = readerPanelLayoutStore.getSnapshot();
    const previous = getReaderPanelLayout(bookId, raw);
    const next = update({ ...previous });
    if (typeof next?.tocOpen !== "boolean" || typeof next?.notesOpen !== "boolean") {
      throw new AppError("reader/invalid-target", "Panel layout requires boolean values");
    }
    const layout = { tocOpen: next.tocOpen, notesOpen: next.notesOpen };
    if (layout.tocOpen === previous.tocOpen && layout.notesOpen === previous.notesOpen) return layout;
    const store = readStore(raw);
    Object.defineProperty(store, bookId, { value: layout, enumerable: true, configurable: true, writable: true });
    return localKV.setItemAsync(STORAGE_KEY, JSON.stringify(store), origin).then(() => layout);
  });
  if (!signal) return work;
  // Cancellation settles the caller promptly; it cannot undo an IPC write that
  // has already started. The queued operation checks again before reading/writing.
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void work.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
