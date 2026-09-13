import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildShelfTools } from "./shelf-tools";

test("blank titles reject before any other requested shelf mutation in either scope", async () => {
  for (const scope of [{ kind: "global", threadId: "shelf-test" }, { kind: "book", bookId: "book" }] as const) {
    const { deps, stores } = createInMemoryDeps({ books: [{ id: "book", title: "Original", starred: false }] });
    const tool = buildShelfTools(scope, deps).find(tool => tool.name === "update_book")!;
    await expect(tool.execute("blank", { bookId: "book", title: " \n\t ", starred: true }))
      .rejects.toMatchObject({ code: "ui/invalid-target" });
    expect(stores.books[0]).toMatchObject({ title: "Original", starred: false });
  }
});

test("update receipts report the re-read values, including host normalization or ignored writes", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Original", author: "Old", starred: false }] });
  const tool = buildShelfTools({ kind: "book", bookId: "book" }, deps).find(tool => tool.name === "update_book")!;
  const result = await tool.execute("trimmed", { title: "  中文书名  ", author: "  作者  ", starred: true });
  expect(result.content[0]).toMatchObject({ text: JSON.stringify({ updated: true, bookId: "book", title: "中文书名", author: "作者", starred: true }) });
  deps.library.editBookMetadata = async () => {};
  const ignored = await tool.execute("ignored", { title: "Not persisted" });
  expect(ignored.content[0]).toMatchObject({ text: JSON.stringify({ updated: false, bookId: "book", title: "中文书名" }) });
});
