import { expect, test } from "bun:test";
import { ReadingSessionController } from "./reading-session-controller";
import { readingRuntime } from "./reading-runtime";
import { emitAppEvent } from "../platform/app-events";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { createReaderPort } from "../features/ai/agent/ports/reader-port";

test("reader demand refreshes its cooldown, expires visibly and cannot cross renderer generations", async () => {
  const runtime = new ReadingSessionController(() => {}, 30_000, 15);
  const id = runtime.begin("book"), seen: unknown[] = [];
  const off = runtime.observe(state => { seen.push(state.readerDemand?.active); });
  runtime.readerDemandActivity(id, "render");
  expect(runtime.snapshot().readerDemand).toMatchObject({ active: true, reason: "render" });
  expect(runtime.readerDemandDelay).toBeGreaterThan(0);
  await Bun.sleep(5); runtime.readerDemandActivity(id, "relocate");
  await Bun.sleep(11); expect(runtime.snapshot().readerDemand?.active).toBe(true);
  await Bun.sleep(10); expect(runtime.snapshot().readerDemand?.active).toBe(false); expect(runtime.readerDemandDelay).toBe(0);
  expect(seen.at(-1)).toBe(false);
  const next = runtime.begin("other"); runtime.readerDemandActivity(id, "render");
  expect(runtime.snapshot().readerDemand?.lastActivityAt).toBeNull();
  runtime.readerDemandActivity(next, "render"); runtime.closed();
  await Bun.sleep(20); expect(runtime.snapshot().readerDemand).toEqual({ active: false, lastActivityAt: null, idleAt: null, reason: null });
  off();
});

test("native activity broadcasts reach granted plugin observers and the Agent through the same session state", async () => {
  const plugin = buildPluginContext({ id: "reader-demand-test", name: "Demand", version: "1", schemaVersion: 1,
    requires: {}, permissions: ["reading:read"] }, "1", []);
  const none = buildPluginContext({ id: "reader-demand-none", name: "None", version: "1", schemaVersion: 1,
    requires: {}, permissions: [] }, "1", []);
  const seen: unknown[] = [];
  try {
    plugin.lifecycle.promote(); none.lifecycle.promote(); expect(none.context.domains.reading).toBeUndefined();
    const id = readingRuntime.begin("book");
    plugin.context.domains.reading!.events.observeSession(state => { seen.push(state.readerDemand); });
    emitAppEvent("reader-demand-activity", { sessionId: id, reason: "relocate" });
    expect(await plugin.context.domains.reading!.queries.session()).toMatchObject({ readerDemand: { active: true, reason: "relocate" } });
    expect(await createReaderPort().getSession()).toMatchObject({ readerDemand: { active: true, reason: "relocate" } });
    await Bun.sleep(0); const count = seen.length; expect(count).toBeGreaterThanOrEqual(1);
    plugin.lifecycle.stop(); emitAppEvent("reader-demand-activity", { sessionId: id, reason: "render" });
    await Bun.sleep(0); expect(seen).toHaveLength(count);
  } finally { plugin.lifecycle.stop(); none.lifecycle.stop(); readingRuntime.closed(); }
});
