import { expect, test } from "bun:test";
import { prepareImageInputs } from "./image-input";
import { createAgentTurnState } from "../tools/turn-state";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildWebTools } from "../tools/web-tools";

const image = { kind: "local" as const, cacheKey: "a".repeat(64), name: "upload.png" };
const png = { mimeType: "image/png" as const, data: "AQID" };
test("vision input is conditional, shares book/web budgets and keeps missing pixels explicit", async () => {
  const { deps } = createInMemoryDeps();
  let reads = 0;
  deps.images = { read: async () => { reads++; return png; } };
  const state = createAgentTurnState();
  state.modelSupportsImages = false;
  expect(JSON.stringify(await prepareImageInputs([image], deps, state))).toContain("no vision input support");
  expect(reads).toBe(0);
  state.modelSupportsImages = true;
  const content = await prepareImageInputs([image], deps, state);
  expect(content.filter(b => b.type === "image")).toEqual([{ type: "image", ...png }]);
  expect(state.modelImageCount).toBe(1);
  state.modelImageCount = 4;
  await expect(prepareImageInputs([image], deps, state)).rejects.toMatchObject({ code: "ai/image-budget-exceeded" });
  deps.images.read = async () => { throw new Error("evicted"); };
  expect(JSON.stringify(await prepareImageInputs([image], deps, state))).toContain("pixels unavailable");
});

for (const vision of [true, false]) test(`presented web images supply pixels only with vision=${vision}`, async () => {
  const { deps } = createInMemoryDeps();
  deps.web = { configured: () => true, search: async input => ({ provider: "fixture", query: input.query, sources: [], retrievedAt: "now", images: [
    { url: "https://example.org/a.png", sourceUrl: "https://example.org/source", title: "A" },
  ] }), fetch: async () => { throw Error("unused"); } };
  let reads = 0;
  deps.images = { read: async () => { reads++; return png; } };
  const state = createAgentTurnState(); state.modelSupportsImages = vision;
  const tools = buildWebTools(deps, state);
  await tools[0]!.execute("search", { query: "diagram", includeImages: true });
  const shown = await tools[2]!.execute("show", { images: [{ id: "web-image-1", caption: "Diagram" }] });
  expect(shown.details.reference.images).toHaveLength(1);
  expect(shown.content.some(b => b.type === "image")).toBe(vision);
  expect(reads).toBe(vision ? 1 : 0);
  expect(state.modelImageCount ?? 0).toBe(vision ? 1 : 0);
});

test("user and previous-answer pixels reach a vision model, are not persisted, and are omitted after switching to text-only", async () => {
  const { registerFauxProvider, streamSimple } = await import("@earendil-works/pi-ai/compat");
  const { fauxAssistantMessage } = await import("@earendil-works/pi-ai/providers/faux");
  const { AgentThread } = await import("./thread");
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
  const { deps, stores } = createInMemoryDeps({ profile: "Established reader" });
  let reads = 0, vision = true;
  deps.images = { read: async () => { reads++; return png; } };
  const requests: string[] = [];
  faux.setResponses([context => { requests.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Shapes."); },
    context => { requests.push(JSON.stringify(context.messages)); return fauxAssistantMessage("This model cannot view images."); }]);
  const thread = new AgentThread({ scope: { kind: "global", threadId: "pixels" }, deps,
    resolveModel: () => ({ ...faux.getModel(), input: vision ? ["text", "image"] : ["text"] }), getApiKey: () => "test",
    streamFn: streamSimple, completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}') });
  try {
    for await (const _ of thread.sendTurn({ text: "Compare these", images: [image], contextImages: [{ kind: "web", url: "https://example.org/a.png", name: "Previous answer" }] })) {}
    expect(requests[0]!.match(/"type":"image"/g)).toHaveLength(2);
    expect(JSON.stringify([...stores.turns])).not.toContain("AQID");
    vision = false;
    for await (const _ of thread.sendTurn({ text: "Look again", images: [image] })) {}
    expect(requests[1]).not.toContain('"type":"image"');
    expect(requests[1]).toContain("no vision input support");
    expect(reads).toBe(2);
  } finally { thread.dispose(); await thread.flushBackgroundWork(); faux.unregister(); }
});
