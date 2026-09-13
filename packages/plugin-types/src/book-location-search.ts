import type {
  BookLocationHit,
  BookLocationSearch,
  BookLocationSearchPage,
} from "@read-aware/core";

/** The small reader contract used by the paged search helper. */
export type BookLocationSearchPageReader = (
  input: BookLocationSearch,
  options?: { signal?: AbortSignal },
) => Promise<BookLocationSearchPage>;

export type BookLocationSearchProgress = {
  scannedSections: number;
  totalSections: number;
  hitCount: number;
  contentVersion: string | null;
};

export type BookLocationSearchRunStatus =
  | "completed"
  | "scan-limit"
  | "result-limit"
  | "timed-out"
  | "cancelled"
  | "stale";

export type BookLocationSearchRun = {
  status: BookLocationSearchRunStatus;
  bookId: string;
  contentVersion: string | null;
  hits: BookLocationHit[];
  scannedSections: number;
  totalSections: number;
  textStatus: BookLocationSearchPage["textStatus"];
};

export type BookLocationSearchRunOptions = {
  signal?: AbortSignal;
  maxSections?: number;
  maxHits?: number;
  maxExcerptBytes?: number;
  timeoutMs?: number;
  onProgress?: (progress: BookLocationSearchProgress) => void | Promise<void>;
};

const HARD_MAX_SECTIONS = 256;
const HARD_MAX_HITS = 200;
const HARD_MAX_EXCERPT_BYTES = 64 * 1024;
const HARD_MAX_TIMEOUT_MS = 30_000;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE_CALLS = 256;
const HIT_OVERHEAD_BYTES = 128;
const TEXT_STATUSES = new Set<BookLocationSearchPage["textStatus"]>([
  "available", "textless", "unsupported", "unsearched", "partial",
]);

type AbortStatus = "timed-out" | "cancelled";
type AwaitOutcome<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "aborted"; status: AbortStatus };

function optionLimit(value: number | undefined, fallback: number, hardMax: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMax) {
    throw Object.assign(new Error(`${name} is outside the bounded search limit`), { code: "library/invalid-search-options" });
  }
  return value;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : undefined;
}

function isStale(error: unknown): boolean {
  const code = errorCode(error);
  return code === "reader/stale-location" || code === "reader/stale-content";
}

function isCancelled(error: unknown): boolean {
  const code = errorCode(error);
  return code === "library/cancelled" || code === "plugin/cancelled"
    || typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

function invalidPage(message: string): Error {
  return Object.assign(new Error(message), { code: "library/search-invalid-page" });
}

function validatePage(page: BookLocationSearchPage, expectedBookId: string, expectedTotal: number | null,
  previousScanned: number, requestCursor: string | undefined): void {
  if (!page || typeof page !== "object" || page.bookId !== expectedBookId
    || typeof page.contentVersion !== "string" || !page.contentVersion
    || !Array.isArray(page.hits) || page.hits.length > MAX_PAGE_SIZE
    || !Number.isSafeInteger(page.scannedSections) || page.scannedSections < 0
    || !Number.isSafeInteger(page.totalSections) || page.totalSections < 0
    || page.scannedSections > page.totalSections
    || page.scannedSections < previousScanned
    || expectedTotal !== null && page.totalSections !== expectedTotal
    || !TEXT_STATUSES.has(page.textStatus)
    || page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 1024)) {
    throw invalidPage("Search page counters or shape are invalid");
  }
  if (page.nextCursor === null && page.scannedSections !== page.totalSections) {
    throw invalidPage("A terminal search page must account for every section");
  }
  if (page.nextCursor !== null && page.nextCursor === requestCursor) {
    throw invalidPage("Search cursor did not advance");
  }
  for (const hit of page.hits) {
    if (!hit || typeof hit !== "object" || typeof hit.id !== "string"
      || !hit.excerpt || typeof hit.excerpt.pre !== "string"
      || typeof hit.excerpt.match !== "string" || typeof hit.excerpt.post !== "string") {
      throw invalidPage("Search page contains an invalid hit");
    }
  }
}

function combineSignal(source: AbortSignal | undefined): {
  signal: AbortSignal;
  abort: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  if (source) {
    source.addEventListener("abort", abort, { once: true });
    if (source.aborted) abort();
  }
  return {
    signal: controller.signal,
    abort,
    dispose: () => source?.removeEventListener("abort", abort),
  };
}

function awaitAbortable<T>(promise: PromiseLike<T>, signal: AbortSignal,
  status: () => AbortStatus | null): Promise<AwaitOutcome<T>> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (outcome: AwaitOutcome<T>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ kind: "aborted", status: status() ?? "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => finish({ kind: "value", value }),
      error => finish({ kind: "error", error }),
    );
    if (signal.aborted) onAbort();
  });
}

function runResult(bookId: string, status: BookLocationSearchRunStatus, contentVersion: string | null,
  hits: BookLocationHit[], scannedSections: number, totalSections: number,
  textStatus: BookLocationSearchPage["textStatus"]): BookLocationSearchRun {
  return { status, bookId, contentVersion, hits, scannedSections, totalSections, textStatus };
}

/**
 * Consume location pages as one activation-scoped bounded operation.
 * Pages are never fetched concurrently and no state is persisted. Section
 * limits are checked between pages: a reader may finish one page above the
 * requested boundary, and a terminal page is still completed when it has no
 * continuation.
 */
export async function searchAllBookLocations(
  reader: BookLocationSearchPageReader,
  input: BookLocationSearch,
  options: BookLocationSearchRunOptions = {},
): Promise<BookLocationSearchRun> {
  const maxSections = optionLimit(options.maxSections, HARD_MAX_SECTIONS, HARD_MAX_SECTIONS, "maxSections");
  const maxHits = optionLimit(options.maxHits, HARD_MAX_HITS, HARD_MAX_HITS, "maxHits");
  const maxExcerptBytes = optionLimit(options.maxExcerptBytes, HARD_MAX_EXCERPT_BYTES, HARD_MAX_EXCERPT_BYTES, "maxExcerptBytes");
  const timeoutMs = optionLimit(options.timeoutMs, HARD_MAX_TIMEOUT_MS, HARD_MAX_TIMEOUT_MS, "timeoutMs");
  const encoder = new TextEncoder();
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const combined = combineSignal(options.signal);
  const abortStatus = (): AbortStatus | null => {
    if (options.signal?.aborted) return "cancelled";
    if (timedOut || Date.now() >= deadline) {
      timedOut = true;
      return "timed-out";
    }
    return null;
  };
  timeoutHandle = setTimeout(() => { timedOut = true; combined.abort(); }, timeoutMs);

  let version: string | null = null;
  let totalSections = 0;
  let expectedTotal: number | null = null;
  let scannedSections = 0;
  let textStatus: BookLocationSearchPage["textStatus"] = "unsearched";
  let cursor = input.cursor;
  let pageCalls = 0;
  let excerptBytes = 0;
  const hits: BookLocationHit[] = [];
  const seenCursors = new Set<string>();
  if (cursor) seenCursors.add(cursor);
  const terminal = (status: BookLocationSearchRunStatus): BookLocationSearchRun => runResult(
    input.bookId, status, status === "stale" ? null : version, [], scannedSections, totalSections, textStatus,
  );
  const emitProgress = async (): Promise<BookLocationSearchRun | null> => {
    const callback = options.onProgress;
    if (!callback) return null;
    const outcome = await awaitAbortable(Promise.resolve().then(() => callback({
      scannedSections, totalSections, hitCount: hits.length, contentVersion: version,
    })), combined!.signal, abortStatus);
    if (outcome.kind === "aborted") return terminal(outcome.status);
    if (outcome.kind === "error") throw outcome.error;
    return null;
  };

  try {
    if (abortStatus()) return terminal(abortStatus()!);
    while (true) {
      if (pageCalls >= MAX_PAGE_CALLS) return runResult(input.bookId, "scan-limit", version, hits, scannedSections, totalSections, textStatus);
      const beforePage = abortStatus();
      if (beforePage) return terminal(beforePage);
      const request: BookLocationSearch = {
        ...input,
        limit: Math.min(input.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE, maxHits - hits.length || 1),
        ...(cursor ? { cursor } : {}),
        ...(version ? { contentVersion: version } : {}),
      };
      const pageOutcome = await awaitAbortable(
        Promise.resolve().then(() => reader(request, { signal: combined!.signal })),
        combined!.signal, abortStatus,
      );
      if (pageOutcome.kind === "aborted") return terminal(pageOutcome.status);
      if (pageOutcome.kind === "error") {
        if (isStale(pageOutcome.error)) return terminal("stale");
        if (isCancelled(pageOutcome.error)) return terminal(abortStatus() ?? "cancelled");
        throw pageOutcome.error;
      }
      const page = pageOutcome.value;
      validatePage(page, input.bookId, expectedTotal, scannedSections, cursor);
      if (version !== null && page.contentVersion !== version) return terminal("stale");
      if (version === null) {
        if (input.contentVersion && page.contentVersion !== input.contentVersion) return terminal("stale");
        version = page.contentVersion;
      }
      if (page.nextCursor && seenCursors.has(page.nextCursor)) throw invalidPage("Search cursor was repeated");
      if (expectedTotal === null) expectedTotal = page.totalSections;
      totalSections = expectedTotal;
      scannedSections = page.scannedSections;
      textStatus = page.textStatus;
      pageCalls++;
      const remainingBytes = maxExcerptBytes - excerptBytes;
      let resultLimited = false;
      for (const hit of page.hits) {
        const hitBytes = encoder.encode(hit.excerpt.pre).byteLength
          + encoder.encode(hit.excerpt.match).byteLength
          + encoder.encode(hit.excerpt.post).byteLength + HIT_OVERHEAD_BYTES;
        if (hits.length >= maxHits || hitBytes > remainingBytes || excerptBytes + hitBytes > maxExcerptBytes) {
          resultLimited = true;
          break;
        }
        hits.push(hit);
        excerptBytes += hitBytes;
      }
      const progressResult = await emitProgress();
      if (progressResult) return progressResult;
      if (resultLimited) return runResult(input.bookId, "result-limit", version, hits, scannedSections, totalSections, textStatus);
      const afterPage = abortStatus();
      if (afterPage) return terminal(afterPage);
      if (!page.nextCursor) return runResult(input.bookId, "completed", version, hits, scannedSections, totalSections, textStatus);
      if (hits.length >= maxHits) return runResult(input.bookId, "result-limit", version, hits, scannedSections, totalSections, textStatus);
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
      if (scannedSections >= maxSections) return runResult(input.bookId, "scan-limit", version, hits, scannedSections, totalSections, textStatus);
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    combined.dispose();
  }
}
