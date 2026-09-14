import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { inferenceAvailability } from "./inference-availability";

test("compiled Text Desk exposes live Smart image prerequisites and preserves unknown remote state", async () => {
  const calls: unknown[] = [], commands = new Map<string, () => Promise<PluginViewResult>>();
  let missing = true;
  const context = { locale: "zh-Hans", domains: { library: { commands: {} }, reading: { commands: {} } },
    services: { session: { operationAvailability: async (input: unknown) => {
      calls.push(input);
      return { operation: "llm.infer", model: "smart", remoteChecked: false, state: missing ? "unconfigured" : "unknown",
        conditions: missing ? [{ kind: "account", state: "unconfigured", reason: "credential-missing", errorCode: "ai/not-configured" }]
          : [{ kind: "model", state: "satisfied", reason: "model-selected" }, { kind: "provider", state: "unknown", reason: "remote-health-not-checked" }] };
    } } },
    contributions: { commands: { register: (command: { id: string; run: () => Promise<PluginViewResult> }) => { commands.set(command.id, command.run); } },
      headerActions: { register() {} }, selectionActions: { register() {} } },
  } as unknown as PluginContext;
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(context);
  const view = (await commands.get("inference-availability")!())!.view as PluginDetailView;
  expect(calls).toEqual([{ operation: "llm.infer", model: "smart", images: true }]);
  expect(JSON.stringify(view.content)).toContain("尚未配置");
  expect(view.content).toContainEqual({ kind: "error", code: "ai/not-configured" });
  missing = false;
  const refreshed = (await view.actions![0]!.run())!.view as PluginDetailView;
  expect(JSON.stringify(refreshed.content)).toContain("未知");
  expect(JSON.stringify(refreshed.content)).toContain("条件满足");
  expect(calls).toHaveLength(2);
  for (const locale of ["en", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const localized = await inferenceAvailability({ ...context, locale }); expect(localized.title).toBeTruthy();
    expect(JSON.stringify(localized.content)).not.toContain("undefined");
  }
});
