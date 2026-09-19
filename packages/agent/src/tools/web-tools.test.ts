import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";

test("web tools refresh availability and recheck it before each call", async () => {
  const { deps } = createInMemoryDeps();
  const scope = { kind: "global" as const, threadId: "web" };
  expect(buildAgentTools(scope, deps).some(tool => tool.name === "web_search")).toBe(false);
  let configured = true, calls = 0;
  deps.web = { configured: () => configured,
    search: async input => { calls++; return { provider: "fixture", query: input.query, sources: [], retrievedAt: "2026-09-19" }; },
    fetch: async input => ({ provider: "fixture", url: input.url, finalUrl: input.url, title: "Page", text: "Text", offset: 0, nextOffset: null, retrievedAt: "2026-09-19" }),
  };
  const tool = buildAgentTools(scope, deps).find(tool => tool.name === "web_search")!;
  await tool.execute("search", { query: "question" }); expect(calls).toBe(1);
  configured = false;
  await expect(tool.execute("search", { query: "question" })).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(calls).toBe(1);
  expect(buildAgentTools({ kind: "book", bookId: "book" }, deps).some(tool => tool.name === "web_fetch")).toBe(false);
});
