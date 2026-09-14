import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { readingAvailability } from "./reading-availability";

test("compiled reading consumer checks prerequisites, allows unknown execution, and keeps the inspected session on refresh/actions", async () => {
  const queries: Record<string, unknown>[] = [], calls: unknown[] = [];
  const commands = new Map<string, () => Promise<PluginViewResult>>();
  let active = false, replaced = false, sessionReads = 0;
  const context = { locale: "zh-Hans", domains: { library: { commands: {} }, reading: {
    queries: { session: async () => { sessionReads++; return { bookId: replaced ? "other" : "book", sessionId: replaced ? "new" : "session" }; } },
    commands: {
      configureMode: async (input: unknown, guard: unknown) => { calls.push(["mode", input, guard]); active = true; },
      controlPlayback: async (action: string, guard: unknown) => { calls.push([action, guard]); if (replaced) throw Object.assign(new Error("Session changed"), { code: "reader/superseded" }); },
    },
  } }, services: { session: { operationAvailability: async (query: Record<string, unknown>) => {
    queries.push(query);
    const conditions = replaced ? [{ kind: "object", state: "unavailable", reason: "reading-session-changed", errorCode: "reader/superseded" }]
      : query.action === "start" && !active ? [{ kind: "input", state: "unavailable", reason: "mode-inactive", errorCode: "reader/unavailable" }]
      : [{ kind: "provider", state: "unknown", reason: "execution-not-checked" }];
    return { operation: query.operation, state: conditions[0]!.state, remoteChecked: false, conditions };
  } } }, contributions: {
    commands: { register: (command: { id: string; run: () => Promise<PluginViewResult> }) => commands.set(command.id, command.run) },
    headerActions: { register() {} }, selectionActions: { register() {} },
  } } as unknown as PluginContext;
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(context);
  const first = (await commands.get("reading-availability")!())!.view as PluginDetailView;
  expect(queries).toHaveLength(3); expect(calls).toHaveLength(0);
  expect(first.actions!.map(action => action.id)).not.toContain("startReadingAloud");
  expect(first.actions!.map(action => action.id)).toContain("stopReadingAloud");
  const enabled = (await first.actions!.find(action => action.id === "enableReadingMode")!.run())!.view as PluginDetailView;
  expect(calls[0]).toEqual(["mode", { active: true }, { bookId: "book", sessionId: "session" }]);
  expect(enabled.actions!.map(action => action.id)).toContain("startReadingAloud");
  replaced = true;
  await expect(enabled.actions!.find(action => action.id === "startReadingAloud")!.run()).rejects.toMatchObject({ code: "reader/superseded" });
  expect(calls[1]).toEqual(["start", { bookId: "book", sessionId: "session" }]);
  const refreshed = (await enabled.actions!.find(action => action.id === "refresh")!.run())!.view as PluginDetailView;
  expect(refreshed.actions!.map(action => action.id)).toEqual(["refresh"]);
  expect(sessionReads).toBe(1);
  expect(queries.every(query => query.bookId === "book" && query.sessionId === "session")).toBe(true);
  for (const locale of ["en", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const view = await readingAvailability({ ...context, locale }, { bookId: "book", sessionId: "session" });
    expect(JSON.stringify(view.content)).not.toContain("undefined"); expect(view.title).toBeTruthy();
  }
});
