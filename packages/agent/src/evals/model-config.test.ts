import { expect, test } from "bun:test";
import { applyEvalRouting } from "./model-config";

test("fixed OpenRouter eval snapshot fits preferred endpoint completion capacity", () => {
  const model = { provider: "openrouter", id: "deepseek/deepseek-v4-flash-0731", maxTokens: 943_718,
    contextWindow: 1_048_576, compat: { supportsReasoningEffort: true } };
  const routed = applyEvalRouting(model);
  expect(routed.maxTokens).toBe(131_072);
  // Actual failed input from the diagnostic run now fits both preferred endpoints.
  expect(118_077 + routed.maxTokens).toBeLessThan(262_144);
  expect(routed.compat).toMatchObject({ supportsReasoningEffort: true,
    openRouterRouting: { order: ["baidu", "coreweave"], allow_fallbacks: true } });
  expect(model.maxTokens).toBe(943_718);
  expect(applyEvalRouting({ ...model, maxTokens: 8_192 }).maxTokens).toBe(8_192);
  expect(applyEvalRouting({ ...model, id: "another-model" }).maxTokens).toBe(943_718);
  const other = { ...model, provider: "deepseek" };
  expect(applyEvalRouting(other)).toBe(other);
});
