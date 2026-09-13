import type {
  AnnotationPageQuery,
  PluginBook,
  PluginBookAccess,
  PluginContext,
  PluginView,
  PluginViewResult,
} from "@read-aware/plugin-types";
import { tr } from "./strings";

type Writer<K extends "annotations" | "reading"> = NonNullable<PluginContext["domains"][K]> & {
  commands: NonNullable<NonNullable<PluginContext["domains"][K]>["commands"]>;
};
export type DeskContext = PluginContext & { domains: PluginContext["domains"] & {
  annotations: Writer<"annotations">;
  reading: Writer<"reading">;
  library: NonNullable<PluginContext["domains"]["library"]>;
} };
export type PageState = Omit<AnnotationPageQuery, "limit"> & { previous: (string | undefined)[] };
export type Refresh = () => Promise<PluginViewResult>;

/** Stable host error used when a plugin call crosses its installed book grant. */
export const BOOK_ACCESS_DENIED = "plugin/object-access-denied";

export function bookGrant(ctx: PluginContext): PluginBookAccess {
  // Hosts predating the public grant metadata retain their legacy full-library
  // behavior until they are upgraded.
  return ctx.grants?.book ?? { mode: "all" };
}

function accessError(operation: string, bookId?: string): Error & { code: string } {
  const target = bookId ? ` for book ${bookId}` : "";
  return Object.assign(
    new Error(`${operation} is outside the plugin book grant${target}`),
    { code: BOOK_ACCESS_DENIED },
  );
}

/**
 * Resolve a caller's requested page book to the immutable grant. Restricted
 * activations always return a concrete book ID, so callers cannot accidentally
 * fall back to an unscoped query when the current reader has no book.
 */
export async function grantedBookId(ctx: DeskContext, requestedBookId?: string): Promise<string | undefined> {
  const grant = bookGrant(ctx);
  if (grant.mode === "all") return requestedBookId || undefined;
  if (grant.mode === "book") {
    if (!grant.bookId || (requestedBookId !== undefined && requestedBookId !== grant.bookId)) {
      throw accessError("annotation book scope", requestedBookId);
    }
    return grant.bookId;
  }

  const session = await ctx.domains.reading.queries.session();
  const currentBookId = session?.bookId;
  if (!currentBookId || (requestedBookId !== undefined && requestedBookId !== currentBookId)) {
    throw accessError("annotation current-book scope", requestedBookId ?? currentBookId ?? undefined);
  }
  return currentBookId;
}

/** Read only the books visible to this activation, without a restricted full-library scan. */
export async function grantedBooks(ctx: DeskContext, requestedBookId?: string): Promise<PluginBook[]> {
  const bookId = await grantedBookId(ctx, requestedBookId);
  if (bookId) {
    const book = await ctx.domains.library.queries.books.get(bookId);
    return book ? [book] : [];
  }
  return ctx.domains.library.queries.books.list();
}

/** Verify every annotation in a batch belongs to one book the activation may use. */
export async function assertAnnotationBooks(
  ctx: DeskContext,
  bookIds: readonly string[],
  operation = "annotation batch",
): Promise<string | undefined> {
  const ids = [...new Set(bookIds)];
  if (bookGrant(ctx).mode === "all") return undefined;
  if (ids.length !== 1 || !ids[0]) throw accessError(operation);
  return grantedBookId(ctx, ids[0]);
}

export function isBookAccessDenied(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === BOOK_ACCESS_DENIED;
}

export function scopeErrorView(ctx: PluginContext, error: unknown): PluginView {
  const code = error !== null && typeof error === "object" && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "annotations/observation-failed";
  return { kind: "detail", title: tr(ctx.locale, "title"), content: [{ kind: "error", code }] };
}

export function assertCapabilities(ctx: PluginContext): asserts ctx is DeskContext {
  if (!ctx.domains.annotations?.commands || !ctx.domains.reading?.commands || !ctx.domains.library) {
    throw new Error("Annotation Desk requires annotations:write, reading:write and library:read");
  }
}
