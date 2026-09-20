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

test("search-only setup exposes search in book and global scopes without advertising unreadable originals", async () => {
  const { deps } = createInMemoryDeps();
  deps.web = { configured: operation => operation !== "fetch",
    search: async input => ({ provider: "serpapi", query: input.query, sources: [], retrievedAt: "2026-09-20" }),
    fetch: async () => { throw new Error("unconfigured"); },
  };
  for (const scope of [{ kind: "book" as const, bookId: "book" }, { kind: "global" as const, threadId: "web" }]) {
    const tools = buildAgentTools(scope, deps).map(tool => tool.name);
    expect(tools).toContain("web_search"); expect(tools).not.toContain("web_fetch");
    const result = await buildAgentTools(scope, deps).find(tool => tool.name === "web_search")!.execute("search", { query: "release" });
    expect(JSON.stringify(result)).toContain("Page reading (web_fetch) is unavailable with the selected provider");
  }
});

test("retrieved image IDs survive tool refresh in a turn but cannot be invented, repeated or reused next turn", async () => {
  const { createAgentTurnState } = await import("./turn-state");
  const { referenceFromToolDetails } = await import("./present-tools");
  const { deps } = createInMemoryDeps();
  const image = { url: "https://images.example.org/roof.png", sourceUrl: "https://museum.example.org/roof", title: "Roof design", description: "Roof cross-section" };
  deps.web = { configured: () => true,
    search: async input => ({ provider: "fixture", query: input.query, sources: [], images: [image], retrievedAt: "2026-09-20" }),
    fetch: async input => ({ provider: "fixture", url: input.url, finalUrl: input.url, title: "Roof", text: "Roof", offset: 0, nextOffset: null, images: [image], retrievedAt: "2026-09-20" }),
  };
  for (const scope of [{ kind: "global" as const, threadId: "images" }, { kind: "book" as const, bookId: "museum" }]) {
    const state = createAgentTurnState();
    const get = (name: string, turn = state) => buildAgentTools(scope, deps, turn).find(t => t.name === name)!;
    const result = await get("web_search").execute("search", { query: "roof", includeImages: true });
    const data = JSON.parse(result.content.map(c => c.type === "text" ? c.text : "").join(""));
    const id = data.images[0].id;
    const chosen = { images: [{ id, caption: "Roof cross-section" }] };
    expect(referenceFromToolDetails((await get("present_web_images").execute("show", { images: [{ id: image.url, caption: "Invented" }] })).details)).toBeUndefined();
    const shown = await get("present_web_images").execute("show", chosen);
    expect(referenceFromToolDetails(shown.details)).toEqual({ kind: "web-images", images: [{ url: image.url, sourceUrl: image.sourceUrl, title: image.title, caption: "Roof cross-section" }] });
    expect(referenceFromToolDetails((await get("present_web_images").execute("again", chosen)).details)).toBeUndefined();
    expect(referenceFromToolDetails((await get("present_web_images", createAgentTurnState()).execute("next", chosen)).details)).toBeUndefined();
  }
});
