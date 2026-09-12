import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView } from "@read-aware/plugin-types";
import { inferenceHistory } from "./inference-history";

test("history shows interrupted observations and unknown cost without offering historical cancellation", async () => {
  const receipt = { requestId: "old", revision: 1, status: "running", settled: false, requestAvailable: false, interrupted: true,
    createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:01Z", errorCode: null,
    attempts: [{ model: { id: "model", provider: "provider" }, stopReason: "error", maxOutputTokens: 100, usage: null, estimatedCostUsd: null }] };
  const ctx = { locale: "en", services: { llm: { listRequests: async () => [receipt], getRequest: async () => receipt } } } as unknown as PluginContext;
  const view = await inferenceHistory(ctx);
  expect(view.items[0].title).toContain("Interrupted");
  const result = await view.items[0].onSelect!();
  const detail = (result as { view: PluginDetailView }).view;
  expect(detail.actions?.some(action => action.id === "cancel")).toBe(false);
  expect(JSON.stringify(detail.content)).toContain("Unknown");
  expect(JSON.stringify(detail.content)).not.toContain("$0");
});
