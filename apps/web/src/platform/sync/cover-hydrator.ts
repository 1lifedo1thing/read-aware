import { actorFromEvent, causalActor, mergeEventCauses, stampEventCause, type DomainActor } from "../domain-actor";
/**
 * Cover hydration — the consumer half of `book.coverExtracted` on a device
 * that did not do the extracting.
 *
 * A pulled `coverExtracted{ready}` projects `cover_status = 'ready'` and
 * leaves a manifest-only blob row: the shelf knows a cover exists before a
 * single image byte is here. This module turns that knowledge into bytes —
 * one small GET per cover — and announces each arrival so the shelf tile
 * repaints on its own, without a reload and without the user opening the book.
 *
 * Why this is a loop and not a one-shot: the importing device pushes its
 * events before its blobs, so the cover is routinely NOT on the relay yet
 * when this device first hears of the book. A miss is normal; it is retried
 * with a growing delay (bounded), and the schedule resets whenever a pull
 * brings new events (the peer is evidently active). Every completed sync
 * cycle also runs a pass, so a cover never needs a second import to appear.
 */
import { invoke } from "../ipc";
import { emitAppEvent } from "../app-events";
import { isTauri } from "../environment";
import { createLogger } from "../logger";

/**
 * The scheduler's blob fetch (`fetchRemoteBlob`), injected so this module
 * never imports the scheduler that drives it. Structural: only the outcome
 * tags the pass reacts to are named here.
 */
export type BlobFetcher = (key: string, origin?: DomainActor) => Promise<
  | { outcome: "fetched" }
  | { outcome: "unavailable" }
  | { outcome: "missing" }
  | { outcome: "failed"; reason: "unauthenticated" | "misdirected" | "undecodable" | "unreachable" }
>;

const log = createLogger("cover-hydrator");

type CoverBacklogEntry = { bookId: string; coverBlobKey: string };

/** First retry after a miss; doubles per miss up to the ceiling. */
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

const misses = new Map<string, { count: number; nextAt: number; origin: DomainActor }>();
let lastFetcher: BlobFetcher | null = null;
let running = false;
let generation = 0;
let lastOrigin: DomainActor | undefined;
let queued: { fetchBlob: BlobFetcher; origin: DomainActor } | undefined;
const join = (first: DomainActor, second: DomainActor): DomainActor => actorFromEvent(
  mergeEventCauses([stampEventCause({}, first), stampEventCause({}, second)], {}));
let retryTimer: number | null = null;

function scheduleRetry(at: number): void {
  const delay = Math.max(1_000, at - Date.now());
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (lastFetcher) void hydrateMissingCovers(lastFetcher, { origin: lastOrigin });
  }, delay);
}

function noteMiss(bookId: string, origin: DomainActor): number {
  const prior = misses.get(bookId)?.count ?? 0;
  const count = prior + 1;
  const nextAt = Date.now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** prior);
  misses.set(bookId, { count, nextAt, origin });
  return nextAt;
}

/**
 * Fetch every cover the shelf is still waiting on. Returns how many landed.
 * `reset` forgets the miss backoff (call it when a pull merged new events).
 * Concurrent calls coalesce into one pass plus one re-run.
 */
export async function hydrateMissingCovers(
  fetchBlob: BlobFetcher,
  options: { reset?: boolean; origin?: DomainActor } = {},
): Promise<number> {
  if (!isTauri()) return 0;
  const origin = causalActor(options.origin ?? "system"), epoch = generation;
  lastFetcher = fetchBlob; lastOrigin = origin;
  if (options.reset) misses.clear();
  if (running) {
    queued = { fetchBlob, origin: queued ? join(queued.origin, origin) : origin };
    return 0;
  }
  running = true;
  let fetched = 0;
  let earliestRetry = Number.POSITIVE_INFINITY;
  try {
    const backlog = await invoke<CoverBacklogEntry[]>("library_cover_backlog");
    if (epoch !== generation) return fetched;
    for (const entry of backlog) {
      const pending = misses.get(entry.bookId);
      if (pending && pending.nextAt > Date.now()) {
        earliestRetry = Math.min(earliestRetry, pending.nextAt);
        continue;
      }
      const source = pending ? join(pending.origin, origin) : origin;
      const result = await fetchBlob(entry.coverBlobKey, source);
      if (epoch !== generation) return fetched;
      switch (result.outcome) {
        case "fetched":
          misses.delete(entry.bookId);
          fetched += 1;
          emitAppEvent("book-changed", { bookId: entry.bookId }, source);
          break;
        case "missing":
          // Not uploaded by the peer yet — the expected race; try again later.
          earliestRetry = Math.min(earliestRetry, noteMiss(entry.bookId, source));
          break;
        case "unavailable":
          // No credentials / sync off: nothing in this pass can succeed.
          return fetched;
        case "failed":
          if (result.reason === "unauthenticated") return fetched;
          log.warn(`cover fetch for ${entry.bookId} failed (${result.reason}); will retry`);
          earliestRetry = Math.min(earliestRetry, noteMiss(entry.bookId, source));
          break;
      }
    }
    if (Number.isFinite(earliestRetry)) scheduleRetry(earliestRetry);
    return fetched;
  } catch (error) {
    log.warn("cover hydration pass failed", error);
    return fetched;
  } finally {
    running = false;
    const next = queued; queued = undefined;
    if (next) void hydrateMissingCovers(next.fetchBlob, { origin: next.origin });
  }
}

/** Drop pending retries (scheduler shutdown / account change). */
export function stopCoverHydration(): void {
  generation++; queued = undefined; lastOrigin = undefined;
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
  misses.clear();
  lastFetcher = null;
}
