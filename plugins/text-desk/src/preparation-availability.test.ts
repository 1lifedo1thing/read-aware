import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView, PluginFormView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { preparationAvailability } from "./preparation-availability";

test("compiled Text Desk checks conditions before execution and preserves rebuild confirmation and target", async () => {
  const queries: unknown[] = [], starts: unknown[] = [], commands = new Map<string, () => Promise<PluginViewResult>>();
  let blocked = true;
  const textState = { bookId: "book", contentVersion: "v", status: "unprepared", text: "unknown", chapterCount: 0, progress: null };
  const task = { taskId: "task", bookId: "book", status: "running", mode: "prepare", priority: "normal", deadlineAt: new Date().toISOString(), textState };
  const ctx = { locale: "en", domains: { library: { queries: { books: {
    list: async () => [{ id: "book", title: "Book", format: "epub" }], getTextState: async () => textState, getTextTask: async () => task,
  } }, commands: { books: { prepareText: async (...args: unknown[]) => { starts.push(args); return task; } } } }, reading: { queries: { session: async () => ({}) }, commands: {} } },
    services: { session: { operationAvailability: async (query: unknown) => { queries.push(query); return { conditions: blocked
      ? [{ kind: "account", state: "unconfigured", reason: "source-sync-credentials-missing", errorCode: "library/content-unavailable" }]
      : [{ kind: "provider", state: "unknown", reason: "not-loaded" }, { kind: "capacity", state: "satisfied", reason: "capacity" }] }; } } },
    contributions: { commands: { register: (command: { id: string; run: () => Promise<PluginViewResult> }) => commands.set(command.id, command.run) }, headerActions: { register() {} }, selectionActions: { register() {} } },
  } as unknown as PluginContext;
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule; await plugin.activate(ctx);
  const list = (await commands.get("open")!())!.view as PluginListView;
  const detail = (await list.items[0]!.onSelect!())!.view as PluginDetailView;
  const denied = (await detail.actions!.find(action => action.id === "preparation-prerequisites")!.run())!.view as PluginDetailView;
  expect(starts).toHaveLength(0); expect(denied.actions!.map(action => action.id)).not.toContain("execute");
  blocked = false;
  const ready = (await denied.actions!.find(action => action.id === "refresh")!.run())!.view as PluginDetailView;
  await ready.actions!.find(action => action.id === "execute")!.run(); expect(starts).toEqual([["book", { rebuild: false }]]);
  const rebuild = (await ready.actions!.find(action => action.id === "switch")!.run())!.view as PluginDetailView;
  const form = (await rebuild.actions!.find(action => action.id === "execute")!.run())!.view as PluginFormView;
  expect(starts).toHaveLength(1); expect(await form.onSubmit({ confirm: false })).toHaveProperty("fieldErrors");
  await form.onSubmit({ confirm: true }); expect(starts[1]).toEqual(["book", { rebuild: true }]);
  expect(queries).toEqual([{ operation: "library.text.prepare", bookId: "book", rebuild: false }, { operation: "library.text.prepare", bookId: "book", rebuild: false }, { operation: "library.text.prepare", bookId: "book", rebuild: true }]);
  for (const locale of ["zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const view = await preparationAvailability({ ...ctx, locale }, "book", "Book");
    expect(JSON.stringify(view.content)).not.toContain("undefined"); expect(JSON.stringify(view.content)).not.toContain("availability_capacity");
  }
});
