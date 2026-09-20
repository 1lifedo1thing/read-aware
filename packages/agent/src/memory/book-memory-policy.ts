import type { ChapterDigest, DigestFlavor } from "@read-aware/core";

/** Trusted host policy, never a caller-controlled graph query parameter. */
export type BookGraphBoundary = { kind: "all" } | { kind: "before"; chapterIndex: number } | { kind: "unknown" };
export type ChapterMemoryPolicy = { flavor: DigestFlavor; boundary: BookGraphBoundary };

type PolicyBook = { narrativity?: DigestFlavor | null; spoilerSensitive?: boolean | null; status?: string };

/** Legacy/unknown books stay conservative until the classifier fills this independent flag. */
export function needsSpoilerProtection(book: PolicyBook | undefined): boolean {
  return book?.status !== "finished" && (book?.spoilerSensitive ?? book?.narrativity !== "expository");
}

export function chapterMemoryPolicy(
  book: PolicyBook | undefined,
  currentChapterIndex?: number,
): ChapterMemoryPolicy {
  const flavor = book?.narrativity ?? "narrative";
  if (book && !needsSpoilerProtection(book)) return { flavor, boundary: { kind: "all" } };
  if (book && currentChapterIndex !== undefined && Number.isSafeInteger(currentChapterIndex) && currentChapterIndex >= 0) {
    return { flavor, boundary: { kind: "before", chapterIndex: currentChapterIndex } };
  }
  return { flavor, boundary: { kind: "unknown" } };
}

/** Apply policy before alias/relationship merging or prompt roster selection. */
export function visibleChapterDigests(digests: readonly ChapterDigest[], boundary: BookGraphBoundary, flavor: DigestFlavor = "narrative"): ChapterDigest[] {
  if (boundary.kind === "unknown" || (boundary.kind === "before" && (!Number.isSafeInteger(boundary.chapterIndex) || boundary.chapterIndex < 0))) return [];
  return digests.filter(digest => (digest.flavor ?? "narrative") === flavor &&
    (boundary.kind !== "before" || digest.chapterIndex < boundary.chapterIndex))
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
}
