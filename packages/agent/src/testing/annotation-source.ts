import { AppError, normalizeBookRangeQuery, type BookTextRange } from "@read-aware/core";
import type { BookTextPort } from "../ports";

/** Memory equivalent of the host's prepareAnnotationSource; never invent a range. */
export async function prepareMemoryAnnotationSource(
  readRange: BookTextPort["readRange"],
  input: { bookId: string; range: BookTextRange; text: string; anchor?: string; chapter?: string },
  signal?: AbortSignal,
): Promise<BookTextRange> {
  const range = normalizeBookRangeQuery({ range: input.range }).range;
  if (range.bookId !== input.bookId || typeof input.text !== "string" || !input.text.trim()
    || input.text.length > 100_000 || input.anchor != null && input.anchor !== range.cfi
    || input.chapter != null) {
    throw new AppError("annotations/invalid-input", "Use a complete range and matching text, without a separate chapter");
  }
  let offset = 0;
  do {
    const page = await readRange({ range, offset, limit: 12000, contextChars: 0 }, signal);
    const end = offset + page.text.length;
    if (page.totalLength !== input.text.length || page.text !== input.text.slice(offset, end)
      || page.offset !== offset || !page.text.length || end > input.text.length
      || (page.nextOffset === null ? end !== input.text.length : page.nextOffset !== end)) {
      throw new AppError("annotations/invalid-input", "Annotation quote does not match the complete source range");
    }
    if (page.nextOffset === null) return structuredClone(page.range);
    offset = page.nextOffset;
  } while (true);
}
