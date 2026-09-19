import { describe, expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { queryLocalApi, type LocalApiReads } from "./local-api";

function fixture() {
  const calls: Array<[string, unknown]> = [];
  const record = (name: string, input: unknown, result: unknown) => { calls.push([name, input]); return Promise.resolve(result); };
  const books = [{ id: "b", title: "习惯", author: "Author" }, { id: "a", title: "Elsewhere" }];
  const reads = {
    library: { books: {
      list: () => record("books", null, books),
      get: (id: string) => record("book", id, books.find(book => book.id === id) ?? null),
      getToc: (id: string) => record("toc", id, [{ index: 0, title: "Chapter", chars: 6 }]),
      getChapterText: (_id: string, index: number) => record("chapter", index, index === 0 ? "abcdef" : null),
      searchText: (input: unknown) => record("search", input, [{ bookId: "b", chapterIndex: 0, text: "habit" }]),
    } },
    reading: { stats: { forBook: (id: string) => record("progress", id, { bookId: id, progressPercent: 35 }),
      list: () => record("reading", null, [{ bookId: "b", progressPercent: 35 }]) } },
    annotations: { page: (input: unknown) => record("annotations", input, { items: [{ kind: "note", body: "Note" }], nextCursor: "next", consistency: "live" }) },
    memory: { page: (input: unknown) => record("memories", input, { items: [], nextOffset: null, revision: "version", total: 0 }) },
  } as unknown as LocalApiReads;
  const errors: unknown[] = [];
  return { reads, calls, errors, get: (path: string, query = "") => queryLocalApi(reads, path, query, error => errors.push(error)) };
}

describe("external agent read API", () => {
  test("health does not query user data; metadata search and pages have stable ordering", async () => {
    const f = fixture();
    expect((await f.get("/v1/health")).status).toBe(200); expect(f.calls).toEqual([]);
    expect((await f.get("/v1/books", "limit=1")).body).toMatchObject({ data: { items: [{ id: "a" }], total: 2, nextOffset: 1 } });
    expect((await f.get("/v1/books", new URLSearchParams({ q: "习惯" }).toString())).body).toMatchObject({ data: { items: [{ id: "b" }], nextOffset: null } });
  });
  test("credential, file, settings and arbitrary domain operations have no route", async () => {
    const f = fixture();
    for (const route of ["/v1/settings", "/v1/secrets", "/v1/invoke", "/v1/queries/library/books/delete", "/v1/files/secret.key", "/v1/books/b/delete"]) {
      expect((await f.get(route)).status).toBe(404);
    }
    expect(f.calls).toEqual([]);
  });
  test("bad and duplicate arguments fail before data reads", async () => {
    const f = fixture();
    for (const [route, query] of [["/v1/books", "limit=0"], ["/v1/books", "limit=101"], ["/v1/books", "limit=1&limit=2"],
      ["/v1/books", "token=secret"], ["/v1/books", "offset=-1"], ["/v1/books", "q="], ["/v1/search", "q=x&throughChapterIndex=3"],
      ["/v1/annotations", "kind=wrong"], ["/v1/memories", "scope=all"], ["/v1/books/%ZZ", ""]]) {
      expect((await f.get(route!, query)).status).toBe(400);
    }
    expect(f.calls).toEqual([]);
  });
  test("book-specific search forwards chapter fences; shelf search states index coverage", async () => {
    const f = fixture();
    expect((await f.get("/v1/search", "q=habit&bookId=b&throughChapterIndex=0&limit=2")).body).toMatchObject({ data: { coverage: "book" } });
    expect(f.calls.at(-1)).toEqual(["search", { queries: ["habit"], bookId: "b", throughChapterIndex: 0, limit: 2 }]);
    expect((await f.get("/v1/search", "q=habit")).body).toMatchObject({ data: { coverage: "locally-indexed-books" } });
    expect((await f.get("/v1/search", "q=habit&bookId=missing")).status).toBe(404);
  });
  test("chapter slices report precise continuation and missing content is not an empty success", async () => {
    const f = fixture();
    expect((await f.get("/v1/books/b/chapters/0", "offset=1&limit=2")).body).toMatchObject({ data: { text: "bc", offset: 1, totalChars: 6, nextOffset: 3 } });
    expect((await f.get("/v1/books/b/chapters/0", "offset=3&limit=3")).body).toMatchObject({ data: { text: "def", nextOffset: null } });
    expect((await f.get("/v1/books/b/chapters/1")).status).toBe(404);
    expect((await f.get("/v1/books/missing")).status).toBe(404);
  });
  test("notes, progress and explicit memory scope retain domain pagination", async () => {
    const f = fixture();
    expect((await f.get("/v1/annotations", "bookId=b&kind=note&cursor=next")).body).toMatchObject({ data: { nextCursor: "next" } });
    expect(f.calls.at(-1)).toEqual(["annotations", { bookId: "b", kind: "note", cursor: "next", limit: 20, query: undefined }]);
    expect((await f.get("/v1/books/b/progress")).body).toMatchObject({ data: { progressPercent: 35 } });
    await f.get("/v1/memories", "scope=book:b&offset=20&revision=version&q=habit");
    expect(f.calls.at(-1)).toEqual(["memories", { scopes: ["book:b"], offset: 20, expectedRevision: "version", query: "habit", limit: 20 }]);
  });
  test("failed reads log the cause but do not leak raw errors or report empty results", async () => {
    const f = fixture();
    f.reads.library.books.list = async () => { throw new Error("SQL /private/file model-api-key=secret"); };
    const result = await f.get("/v1/books");
    expect(result.status).toBe(503); expect(JSON.stringify(result)).not.toContain("secret"); expect(f.errors).toHaveLength(1);
    f.reads.memory.page = async () => { throw new AppError("memory/conflict", "stale"); };
    expect((await f.get("/v1/memories", "scope=user")).status).toBe(409);
  });
});
