import { expect, test } from "bun:test";
import { ReadingSessionController, type ReadingEngineAdapter } from "./reading-session-controller";
import { readingRuntime } from "./reading-runtime";
import { createReadingDomain } from "./reading";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { createReaderPort } from "../features/ai/agent/ports/reader-port";
import type { ReadingSessionSnapshot } from "@read-aware/core";

const at = (cfi: string, bookId = "book") => ({ bookId, contentVersion: "v1", cfi });
const engine = (): ReadingEngineAdapter => ({ navigate: async target => at(target.cfi ?? "start", target.bookId), step: async direction => at(direction) });

test("command attribution is stamped at completion; pending, failed and cancelled work cannot relabel renderer feedback", async () => {
  const runtime = new ReadingSessionController();
  const id = runtime.begin("book"), adapter = engine(); runtime.attach(id, adapter, at("start"));
  expect(runtime.snapshot().change).toEqual({ origin: "system", reason: "ready" });
  let finish!: (value: ReturnType<typeof at>) => void;
  adapter.navigate = () => new Promise(resolve => { finish = resolve; });
  const pending = runtime.navigate({ cfi: "one" }, undefined, "plugin:one"); await Bun.sleep(0);
  runtime.relocate(id, at("rendered"), "visible", adapter);
  expect(runtime.snapshot().change).toEqual({ origin: "system", reason: "relocate" });
  finish(at("one")); await pending;
  expect(runtime.snapshot().change).toEqual({ origin: "plugin:one", reason: "navigate" });
  const copy = runtime.snapshot(); copy.change!.origin = "user";
  expect(runtime.snapshot().change!.origin).toBe("plugin:one");
  const abort = new AbortController(), cancelled = runtime.navigate({ cfi: "late" }, abort.signal, "agent").catch(error => error);
  await Bun.sleep(0); abort.abort(Error("cancelled")); await cancelled;
  finish(at("late")); await Bun.sleep(0);
  expect(runtime.snapshot().location?.cfi).toBe("one"); expect(runtime.snapshot().change!.origin).toBe("plugin:one");
  adapter.navigate = async () => { throw Error("missing"); };
  await expect(runtime.navigate({ cfi: "missing" }, undefined, "user")).rejects.toThrow("missing");
  expect(runtime.snapshot().change!.origin).toBe("plugin:one");
  runtime.closed();
});

test("opening tokens, readiness, closing and replacement retain honest origins and generation fences", async () => {
  const runtime = new ReadingSessionController(); const seen: ReadingSessionSnapshot[] = [];
  runtime.observe(value => { seen.push(value); });
  let id = "";
  runtime.bindShell({ open: (bookId, intent) => { id = runtime.begin(bookId, intent); runtime.attach(id, engine(), at("start", bookId)); }, close: () => runtime.closed() });
  await runtime.navigate({ bookId: "book" }, undefined, "agent");
  expect(seen.find(value => value.status === "loading")!.change).toEqual({ origin: "agent", reason: "open" });
  expect(seen.find(value => value.status === "ready")!.change).toEqual({ origin: "agent", reason: "ready" });
  await runtime.close(undefined, undefined, "plugin:closer");
  expect(runtime.snapshot().change).toEqual({ origin: "plugin:closer", reason: "close" });
  const next = runtime.begin("other"); const before = runtime.snapshot();
  runtime.relocate(id, at("old"), "old"); runtime.fail(id, Error("old failure"));
  expect(runtime.snapshot()).toEqual(before);
  runtime.fail(next, Error("new failure")); expect(runtime.snapshot().change).toEqual({ origin: "system", reason: "error" });
  runtime.closed();
});

test("granted plugin and Agent use the same attributed state; callers cannot supply an actor and retired observation stops", async () => {
  const plugin = buildPluginContext({ id: "session-change", name: "Change", version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:write"] }, "1", []);
  const readOnly = buildPluginContext({ id: "session-change-reader", name: "Read", version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:read"] }, "1", []);
  const observed: ReadingSessionSnapshot[] = [];
  try {
    plugin.lifecycle.promote(); readOnly.lifecycle.promote();
    const id = readingRuntime.begin("book"), adapter = engine(); readingRuntime.attach(id, adapter, at("start"));
    const reading = plugin.context.domains.reading!;
    readOnly.context.domains.reading!.events.observeSession(value => { observed.push(value); });
    expect(readOnly.context.domains.reading!.commands).toBeUndefined();
    await reading.commands!.goTo({ cfi: "plugin", origin: "user" } as never);
    expect((await reading.queries.session()).change).toEqual({ origin: "plugin:session-change", reason: "navigate" });
    const agent = createReaderPort(); await agent.step("next");
    expect((await agent.getSession()).change).toEqual({ origin: "agent", reason: "step" });
    await createReadingDomain("user").commands.back();
    expect((await agent.getSession()).change).toEqual({ origin: "user", reason: "back" });
    await Bun.sleep(0); expect(observed.at(-1)!.change).toEqual({ origin: "user", reason: "back" });
    readOnly.lifecycle.stop(); const count = observed.length;
    readingRuntime.relocate(id, at("native"), "", adapter); await Bun.sleep(0); expect(observed).toHaveLength(count);
  } finally { plugin.lifecycle.stop(); readOnly.lifecycle.stop(); readingRuntime.closed(); }
});
