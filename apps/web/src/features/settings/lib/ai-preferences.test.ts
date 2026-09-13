import { expect, test } from "bun:test";
import { normalizeAIPreferences } from "./ai-preferences";

test("retired localOnly values are ignored while independent privacy choices survive", () => {
  const legacy = {
    localOnly: true,
    buildMemory: false,
    sendHighlightedText: false,
    sendSurroundingContext: false,
    followStreaming: true,
  };
  const preferences = normalizeAIPreferences(legacy);
  expect(preferences).not.toHaveProperty("localOnly");
  expect(preferences.features.translate).toBe(true);
  expect(preferences).toMatchObject({
    buildMemory: false, sendHighlightedText: false,
    sendSurroundingContext: false, followStreaming: true,
  });
  expect(JSON.parse(JSON.stringify(normalizeAIPreferences({ ...preferences, ...legacy }))))
    .not.toHaveProperty("localOnly");
});
