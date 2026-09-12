import { AppError, normalizeBookRangeQuery, type BookTextRange } from "@read-aware/core";
import { readBookRange } from "../features/library/lib/book-range";
import { getBookContentState } from "./book-content-state";

/** Caller text must describe the entire source, not a truncated search preview.
 * Resolve through the same parser as readRange; never mint a version for a CFI. */
export async function prepareAnnotationSource(input: {
  bookId: string; range: BookTextRange; text: string; anchor?: string | null; chapterHref?: string | null;
}, signal?: AbortSignal) {
  const range = normalizeBookRangeQuery({ range: input.range }).range;
  const text = input.text;
  if (range.bookId !== input.bookId || typeof input.text !== "string" || !input.text.trim()
    || input.text.length > 100_000 || input.anchor != null && input.anchor !== range.cfi
    || input.chapterHref != null) {
    throw new AppError("annotations/invalid-input", "Use a complete range and matching text, without a separate chapter");
  }
  const source = await getBookContentState(range.bookId, signal);
  let offset = 0, resolved = range;
  do {
    const page = await readBookRange({ range, offset, limit: 12000, contextChars: 0 }, signal);
    const end = offset + page.text.length;
    if (page.totalLength !== text.length || page.text !== text.slice(offset, end)
      || page.offset !== offset || !page.text.length || end > text.length
      || (page.nextOffset === null ? end !== text.length : page.nextOffset !== end)) {
      throw new AppError("annotations/invalid-input", "Annotation quote does not match the complete source range");
    }
    resolved = page.range;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  } while (true);
  // Virtual providers are host-owned, not SQLite content. Recheck their
  // binding/activation/invalidation at dispatch; files also get a native CAS.
  const beforeDispatch = async () => {
    signal?.throwIfAborted();
    const current = await getBookContentState(range.bookId, signal);
    if (current.sourceRevision !== source.sourceRevision || current.source !== source.source
      || current.availability !== source.availability) {
      throw new AppError("reader/stale-location", "Annotation source changed before dispatch");
    }
  };
  await beforeDispatch();
  return { range: resolved, signal, beforeDispatch };
}
