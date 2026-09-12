import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { boundedMemoryComplete } from "./model-budget";
const model = { maxTokens: 8000 } as Model<Api>;
test("memory calls cap model output and reject oversized prompts before dispatch", async () => {
  let calls = 0;
  const complete = boundedMemoryComplete(async (_model, _context, options) => { calls++; expect(options?.maxTokens).toBe(8000); return fauxAssistantMessage("Fine"); });
  await expect(complete(model, { systemPrompt: "x".repeat(262145), messages: [] })).rejects.toMatchObject({ code: "memory/input-budget-exceeded" });
  expect(calls).toBe(0);
  expect((await complete(model, { messages: [{ role: "user", content: "Text", timestamp: 0 }] })).content).toHaveLength(1);
});
test("memory output overflow is not a successful judgement", async () => {
  const complete = boundedMemoryComplete(async () => fauxAssistantMessage("x".repeat(262145)));
  await expect(complete(model, { messages: [] })).rejects.toMatchObject({ code: "memory/output-budget-exceeded" });
});
