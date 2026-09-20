import type { BookProgress, LibraryBook, ReadingStatus } from "./library-types";

function fraction(progress: NonNullable<BookProgress>): number {
  return progress.currentLocation >= 0 && progress.totalLocations > 0
    ? Math.max(0, Math.min(1, progress.currentLocation / progress.totalLocations))
    : Math.max(0, Math.min(100, progress.progressPercent)) / 100;
}

/** Same text-CFI start key as storage/reading_progress.rs. Endpoints describe
 * visible ranges and must not turn a viewport resize into forward reading. */
function cfiStart(value: string): number[][][] | null {
  if (!value.startsWith("epubcfi(") || !value.endsWith(")")) return null;
  let stripped = "", assertion = false, escaped = false;
  for (const char of value.slice(8, -1)) {
    if (escaped) { escaped = false; continue; }
    if (char === "^") { escaped = true; continue; }
    if (char === "[") { assertion = true; continue; }
    if (char === "]") { assertion = false; continue; }
    if (!assertion) stripped += char;
  }
  if (assertion || escaped) return null;
  const parts = stripped.split(",");
  const start = parts.length === 1 ? parts[0]! : parts.length === 3 ? parts[0]! + parts[1]! : null;
  if (start === null) return null;
  const paths: number[][][] = [];
  for (const path of start.split("!")) {
    if (!path.startsWith("/")) return null;
    const steps: number[][] = [];
    for (const step of path.slice(1).split("/")) {
      if (!/^\d+(?::\d+)?$/.test(step)) return null;
      const [index, offset = 0] = step.split(":").map(Number);
      steps.push([index!, offset]);
    }
    paths.push(steps);
  }
  return paths;
}

function comparePath(left: number[][][], right: number[][][]): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const a = left[i]!, b = right[i]!;
    for (let j = 0; j < Math.min(a.length, b.length); j++) {
      const difference = a[j]![0]! - b[j]![0]! || a[j]![1]! - b[j]![1]!;
      if (difference) return difference;
    }
    if (a.length !== b.length) return a.length - b.length;
  }
  return left.length - right.length;
}

/** Optimistic shelf state follows the same monotonic rule as native storage.
 * Live reader page/cursor state remains owned by the reader session. */
export function compareReadingProgress(left: NonNullable<BookProgress>, right: NonNullable<BookProgress>): number {
  const distance = fraction(left) - fraction(right);
  if (distance) return distance;
  const leftLocator = left.cfi ?? left.href ?? "", rightLocator = right.cfi ?? right.href ?? "";
  const a = cfiStart(leftLocator), b = cfiStart(rightLocator);
  const precise = a && b ? comparePath(a, b) : Number(!!a) - Number(!!b);
  if (precise) return precise;
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return compare(leftLocator, rightLocator) || compare(left.href ?? "", right.href ?? "");
}

export function getReadingStatus(progressPercent: number): ReadingStatus {
  if (progressPercent >= 100) return "finished";
  if (progressPercent > 0) return "reading";
  return "unread";
}

export function createProgressPatch(
  book: LibraryBook,
  progress: BookProgress,
  timestamp = new Date().toISOString(),
): LibraryBook {
  if (book.progress && (!progress || compareReadingProgress(progress, book.progress) < 0)) {
    return { ...book, updatedAt: timestamp, lastOpenedAt: timestamp };
  }
  const progressPercent = progress ? Math.max(0, Math.min(100, Math.round(progress.progressPercent))) : 0;

  return {
    ...book,
    progress,
    progressPercent,
    readingStatus: getReadingStatus(progressPercent),
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  };
}
