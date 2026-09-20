import { AppError } from "./errors";
import type { DigestFlavor } from "./book-memory";

/** Device-local classification + relevant event identity, not a content version or distributed CAS. */
export type BookClassificationSnapshot = { bookId: string; narrativity: DigestFlavor | null; spoilerSensitive?: boolean | null; revision: string };
export type BookClassificationChange = { bookId: string; narrativity: DigestFlavor; spoilerSensitive?: boolean; expectedRevision: string };
export type BookClassificationReceipt = { snapshot: BookClassificationSnapshot; changed: boolean };

export function validateClassificationBookId(id: string): void {
  if (typeof id !== "string" || !id.trim() || id.length > 256) throw new AppError("memory/invalid-input", "Expected a book ID");
}
export function normalizeBookClassification(input: BookClassificationChange): BookClassificationChange {
  const fail = (): never => { throw new AppError("memory/invalid-input", "Invalid conditional book classification"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  validateClassificationBookId(input.bookId);
  if (input.narrativity !== "narrative" && input.narrativity !== "expository") return fail();
  if (typeof input.expectedRevision !== "string" || !/^bcl1:[a-f0-9]{64}$/.test(input.expectedRevision)) return fail();
  if (input.spoilerSensitive !== undefined && typeof input.spoilerSensitive !== "boolean") return fail();
  if (Object.keys(input).some(key => !["bookId", "narrativity", "spoilerSensitive", "expectedRevision"].includes(key))) return fail();
  return { bookId: input.bookId, narrativity: input.narrativity, ...(input.spoilerSensitive !== undefined ? { spoilerSensitive: input.spoilerSensitive } : {}), expectedRevision: input.expectedRevision };
}
