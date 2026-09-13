import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookTextTools } from "./book-text-tools";
import { createAgentTurnState } from "./turn-state";

test("TOC repair evidence contains catalog metadata without reading future prose", async () => {
  const id = "toc-book" as Id;
  const { deps } = createInMemoryDeps({ books: [{ id, title: "Omnibus" }] });
  deps.bookText.getToc = async () => [{ index: 43, title: "Volume II", chars: 900 }];
  deps.bookText.getChapterText = async () => { throw new Error("must not read prose"); };
  const state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 2 };
  const tool = buildBookTextTools({ kind: "book", bookId: id }, deps, state).find(t => t.name === "get_toc")!;
  await tool.execute("toc", {});
  expect(JSON.parse(state.evidenceTexts[0]!)).toEqual([{ chapterIndex: 43, chapterNumber: 44, title: "Volume II", chars: 900 }]);
});
