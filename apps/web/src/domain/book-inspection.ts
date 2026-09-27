import {
  AppError,
  BOOK_IMPORT_FORMATS,
  errorCode,
  type BookFormatCapability,
  type BookInspection,
} from "@read-aware/core";
import type { ResourceOwner, NativeResource } from "../services/resource-owner";
import { resourceBookFile } from "../platform/resource-book-file";
import { createLogger } from "../platform/logger";
import { formatFromName } from "../features/library/lib/import-format";
import { sniffBookFormat } from "../features/library/lib/book-format-sniff";
import { parseBookFile } from "../features/reader/lib/parse-book";
import type { FoliateBook } from "../features/reader/lib/foliate-engine";

const log = createLogger("book-inspection");
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;

export async function listBookFormats(): Promise<BookFormatCapability[]> {
  return BOOK_IMPORT_FORMATS.map((entry) => ({
    ...entry,
    extensions: [...entry.extensions],
    mimeTypes: [...entry.mimeTypes],
  }));
}

async function inspect(resource: NativeResource, signal?: AbortSignal): Promise<BookInspection> {
  const opened: { book?: FoliateBook } = {};
  let result: BookInspection;
  try {
    result = await inspectOpened(resource, opened, signal);
  } catch (error) {
    // The inspection failure (abort, lease or storage) outranks a cleanup failure.
    try {
      await opened.book?.destroy?.();
    } catch (cleanupError) {
      log.warn("Book inspection cleanup also failed", cleanupError);
    }
    throw error;
  }
  if (opened.book) {
    try {
      await opened.book.destroy?.();
    } catch (error) {
      log.warn("Book inspection cleanup failed", error);
      throw new AppError("internal", "Book inspection cleanup failed");
    }
  }
  return result;
}

async function inspectOpened(
  resource: NativeResource,
  opened: { book?: FoliateBook },
  signal?: AbortSignal,
): Promise<BookInspection> {
  const file = resourceBookFile(resource, signal);
  let formatHint = formatFromName(resource.name, resource.mimeType);
  try {
    signal?.throwIfAborted();
    if (!formatHint)
      formatHint = await sniffBookFormat(new File([await file.slice(0, 65536).arrayBuffer()], resource.name));
    if (!file.size)
      return {
        formatHint,
        coverage: "initialization",
        status: "failed",
        errorCode: "book/parse-failed",
        sectionCount: null,
      };
    const book = (opened.book = await parseBookFile(file));
    signal?.throwIfAborted();
    return {
      formatHint,
      coverage: "initialization",
      status: "parsed",
      sectionCount: book.sections.length,
      errorCode: null,
    };
  } catch (error) {
    signal?.throwIfAborted();
    log.warn("Book initialization inspection failed", error);
    const code = errorCode(error);
    const encrypted =
      code === "book/unsupported-encryption" || (error instanceof Error && error.name === "PasswordException");
    // Lease/storage failures are failed operations, not evidence that the book is corrupt.
    if (code && !code.startsWith("book/")) throw error;
    return {
      formatHint,
      coverage: "initialization",
      status: encrypted ? "encrypted" : code === "book/unsupported-format" ? "unsupported" : "failed",
      sectionCount: null,
      errorCode: encrypted ? "book/unsupported-encryption" : (code ?? "book/parse-failed"),
    };
  }
}

/** Read-only initialization under the same parser as the reader; no shelf or blob writes. */
export function inspectResourceBook(owner: ResourceOwner, id: string, signal?: AbortSignal): Promise<BookInspection> {
  signal?.throwIfAborted();
  if (pending >= 8) return Promise.reject(new AppError("ui/unavailable", "Book inspection queue is full"));
  pending++;
  const result = owner.use(
    id,
    (resource) => {
      const work = tail
        .catch(() => {
          /* A failed inspection must not poison later requests. */
        })
        .then(() => {
          signal?.throwIfAborted();
          return inspect(resource, signal);
        });
      tail = work;
      return work;
    },
    signal,
  );
  return result.finally(() => {
    pending--;
  });
}
