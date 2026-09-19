import { AppError, errorCode, type MemoryScope } from "@read-aware/core";
import type { DomainApi } from "./registry";

/** Deliberately no settings, credentials, files, SQL, IPC, commands or arbitrary
 * method dispatch. Public domain read models already omit storage internals. */
export type LocalApiReads = {
  library: DomainApi["library"]["queries"];
  reading: DomainApi["reading"]["queries"];
  annotations: DomainApi["annotations"]["queries"];
  memory: Pick<DomainApi["memory"]["queries"], "page">;
};
export type LocalApiReply = { status: number; body: unknown };
const invalid = () => new AppError("local-api/invalid-input", "Invalid query parameters");
const fail = (status: number, code: string, message: string): LocalApiReply => ({ status, body: { error: { code, message } } });
const ok = (data: unknown): LocalApiReply => ({ status: 200, body: { data } });
function parameters(raw: string, allowed: string[]) {
  const params = new URLSearchParams(raw);
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw invalid();
  return {
    text(key: string, max = 500): string | undefined {
      const value = params.get(key);
      if (value === null) return undefined;
      if (!value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) throw invalid();
      return value;
    },
    integer(key: string, fallback: number, max: number, min = 0): number {
      const raw = params.get(key);
      if (raw === null) return fallback;
      if (!/^\d+$/u.test(raw)) throw invalid();
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid();
      return value;
    },
  };
}
function page<T>(items: T[], offset: number, limit: number) {
  return { items: items.slice(offset, offset + limit), total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null };
}

export async function queryLocalApi(reads: LocalApiReads, path: string, rawQuery: string,
  report: (error: unknown) => void, signal?: AbortSignal): Promise<LocalApiReply> {
  try {
    signal?.throwIfAborted();
    if (path === "/v1/health") {
      parameters(rawQuery, []);
      return ok({ app: "ReadAware", apiVersion: 1, readOnly: true });
    }
    if (path === "/v1/books") {
      const q = parameters(rawQuery, ["q", "offset", "limit"]);
      const query = q.text("q")?.toLocaleLowerCase(), offset = q.integer("offset", 0, 1_000_000), limit = q.integer("limit", 20, 100, 1);
      const books = (await reads.library.books.list()).filter(book => !query || `${book.title} ${book.author ?? ""}`.toLocaleLowerCase().includes(query));
      return ok(page(books.sort((a, b) => a.id.localeCompare(b.id)), offset, limit));
    }
    if (path === "/v1/search") {
      const q = parameters(rawQuery, ["q", "bookId", "throughChapterIndex", "limit"]);
      const query = q.text("q", 1024), bookId = q.text("bookId", 256);
      if (!query || !bookId && q.text("throughChapterIndex")) throw invalid();
      if (bookId && !await reads.library.books.get(bookId)) return fail(404, "reader/book-not-found", "Book not found.");
      const hits = await reads.library.books.searchText({ queries: [query], bookId, limit: q.integer("limit", 16, 100, 1),
        ...(q.text("throughChapterIndex") ? { throughChapterIndex: q.integer("throughChapterIndex", 0, 1_000_000) } : {}) }, signal);
      return ok({ items: hits, coverage: bookId ? "book" : "locally-indexed-books" });
    }
    const bookRoute = /^\/v1\/books\/([^/]+)(?:\/(toc|progress|chapters\/\d+))?$/u.exec(path);
    if (bookRoute) {
      const bookId = decodeURIComponent(bookRoute[1]!);
      if (!bookId.trim() || bookId.length > 256) throw invalid();
      const suffix = bookRoute[2];
      const q = parameters(rawQuery, suffix?.startsWith("chapters/") ? ["offset", "limit"] : []);
      const book = await reads.library.books.get(bookId);
      if (!book) return fail(404, "reader/book-not-found", "Book not found.");
      if (!suffix) return ok(book);
      if (suffix === "progress") return ok(await reads.reading.stats.forBook(bookId));
      if (suffix === "toc") return ok({ items: await reads.library.books.getToc(bookId) });
      const chapterIndex = Number(suffix.slice("chapters/".length));
      if (!Number.isSafeInteger(chapterIndex) || chapterIndex > 1_000_000) throw invalid();
      const offset = q.integer("offset", 0, Number.MAX_SAFE_INTEGER), limit = q.integer("limit", 8_000, 32_000, 1);
      const text = await reads.library.books.getChapterText(bookId, chapterIndex);
      if (text === null) return fail(404, "local-api/not-found", "Chapter not found.");
      return ok({ bookId, chapterIndex, text: text.slice(offset, offset + limit), offset, totalChars: text.length,
        nextOffset: offset + limit < text.length ? offset + limit : null });
    }
    if (path === "/v1/annotations") {
      const q = parameters(rawQuery, ["bookId", "kind", "q", "limit", "cursor"]);
      const kind = q.text("kind");
      if (kind !== undefined && kind !== "note" && kind !== "highlight" && kind !== "ask") throw invalid();
      return ok(await reads.annotations.page({ bookId: q.text("bookId", 256), kind, query: q.text("q"),
        limit: q.integer("limit", 20, 100, 1), cursor: q.text("cursor", 8192) }));
    }
    if (path === "/v1/reading") {
      const q = parameters(rawQuery, ["offset", "limit"]);
      const offset = q.integer("offset", 0, 1_000_000), limit = q.integer("limit", 20, 100, 1);
      const records = await reads.reading.stats.list();
      return ok(page(records.sort((a, b) => a.bookId.localeCompare(b.bookId)), offset, limit));
    }
    if (path === "/v1/memories") {
      const q = parameters(rawQuery, ["scope", "q", "offset", "limit", "revision"]);
      const scope = q.text("scope", 261);
      if (!scope || scope !== "user" && scope !== "global" && !/^book:\S.{0,255}$/u.test(scope)) throw invalid();
      return ok(await reads.memory.page({ scopes: [scope as MemoryScope], query: q.text("q", 2000),
        offset: q.integer("offset", 0, 1_000_000), limit: q.integer("limit", 20, 100, 1), expectedRevision: q.text("revision", 128) }));
    }
    return fail(404, "local-api/not-found", "Unknown API route. Consult the ReadAware Skill.");
  } catch (error) {
    report(error);
    const code = errorCode(error);
    if (error instanceof URIError || code === "local-api/invalid-input" || code?.endsWith("/invalid-query")
      || code?.endsWith("/invalid-input") || code?.endsWith("/invalid-cursor")) {
      return fail(400, "local-api/invalid-input", "Invalid query. Check the Skill for accepted parameters and limits.");
    }
    if (code === "memory/conflict") return fail(409, code, "Memory changed. Restart pagination from offset 0.");
    // Never return raw exceptions: paths, SQL or provider credentials can occur in them.
    return fail(503, "local-api/unavailable", "Could not read the requested data. Check ReadAware and retry.");
  }
}
