import { expect, test } from "bun:test";
import { AppError, normalizeHostWindowRequest, type HostWindowObservation, type HostWindowRequest, type HostWindowState } from "@read-aware/core";
import { HostWindowService, type WindowAdapter } from "./window-controller";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { actorCause, causalActor, eventCause, stampEventCause } from "../platform/domain-actor";
import { hostWindow } from "./window";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const state: HostWindowState = { minimized: false, maximized: false, fullscreen: false, focused: true };
  const calls: HostWindowRequest[] = [], errors: unknown[] = [];
  const viewport = { width: 800, height: 600 };
  let changed = () => {}, stops = 0;
  const adapter: WindowAdapter = {
    supported: () => true, read: async () => ({ ...state, viewport: { ...viewport } }),
    apply: async request => {
      calls.push(request);
      if (request.action === "fullscreen") state.fullscreen = request.enabled;
      else if (request.action === "minimize") state.minimized = true;
      else if (request.action === "maximize") { state.minimized = false; state.maximized = true; Object.assign(viewport, { width: 1200, height: 900 }); }
      else { Object.assign(state, { minimized: false, maximized: false, fullscreen: false }); Object.assign(viewport, { width: 800, height: 600 }); }
    },
    watch: async handler => { changed = handler; return () => { stops++; }; },
  };
  const service = new HostWindowService(adapter, error => errors.push(error));
  return { service, adapter, state, viewport, calls, errors, changed: () => changed(), get stops() { return stops; } };
}

test("public event-bound window requests retain source in receipts and exact sampled geometry", async () => {
  const f = fixture(), original = hostWindow.control;
  hostWindow.control = (request, signal, origin) => f.service.control(request, signal, origin);
  const runtime = buildPluginContext({ id: "window-cause", name: "Window", version: "1", schemaVersion: 1, requires: {} }, "1", []);
  runtime.lifecycle.promote();
  const rule = {};
  try {
    await runtime.reactions.deliver(rule, stampEventCause({}, causalActor("user")), async reaction => {
      const actor = runtime.reactions.actor(reaction);
      const receipt = await runtime.context.withEvent({ reaction }).services.ui.window!.control({ action: "maximize" });
      expect(eventCause(receipt.snapshot)).toBe(actorCause(actor));
      expect(eventCause((await f.service.layout())!)).toBe(actorCause(actor));
      expect(receipt.snapshot).not.toHaveProperty("viewport");
      await runtime.reactions.deliver(rule, receipt.snapshot, next => { expect(next.status).toBe("cycle"); });
      await f.service.control({ action: "maximize" }, undefined, causalActor("user"));
      expect(eventCause((await f.service.layout())!)).toBe(actorCause(actor)); // no-op cannot relabel geometry
    });
    f.viewport.width = 1100; f.state.maximized = false;
    const user = await f.service.layout();
    expect(user).toEqual({ width: 1100, height: 900 });
    await runtime.reactions.deliver(rule, user!, next => { expect(next.status).toBe("ready"); });
  } finally { hostWindow.control = original; runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); }
});

test("layout reads wait behind native dispatch and cancelled or partially failed effects retain their source", async () => {
  const f = fixture(), held = Promise.withResolvers<void>(), source = causalActor("plugin:window"), abort = new AbortController();
  const apply = f.adapter.apply;
  f.adapter.apply = async request => { await held.promise; await apply(request); abort.abort(new AppError("plugin/cancelled", "Retired")); };
  const request = f.service.control({ action: "maximize" }, abort.signal, source).catch(error => error);
  let complete = false;
  const layout = f.service.layout().then(value => { complete = true; return value; });
  await tick(); expect(complete).toBe(false);
  held.resolve(); expect(await request).toMatchObject({ code: "plugin/cancelled" });
  const observed = await layout;
  expect(observed).toEqual({ width: 1200, height: 900 });
  expect(eventCause(observed!)).toBe(actorCause(source));
  const partial = causalActor("plugin:restore");
  f.adapter.apply = async () => { f.state.maximized = false; f.viewport.width = 900; throw new AppError("ipc/unknown", "Second native step failed"); };
  await expect(f.service.control({ action: "restore" }, undefined, partial)).rejects.toMatchObject({ code: "ipc/unknown" });
  expect(eventCause((await f.service.layout())!)).toBe(actorCause(partial));
});

test("a layout read admitted after a new command never shares the earlier in-flight sample", async () => {
  const f = fixture(), firstRead = Promise.withResolvers<HostWindowState & { viewport: { width: number; height: number } }>();
  const read = f.adapter.read;
  let count = 0;
  f.adapter.read = () => ++count === 1 ? firstRead.promise : read();
  const before = f.service.layout(); await tick();
  const source = causalActor("plugin:window");
  const request = f.service.control({ action: "maximize" }, undefined, source);
  const after = f.service.layout();
  firstRead.resolve({ ...f.state, viewport: { width: 800, height: 600 } });
  expect(await before).toEqual({ width: 800, height: 600 });
  await request;
  const current = await after;
  expect(current).toEqual({ width: 1200, height: 900 });
  expect(eventCause(current!)).toBe(actorCause(source));
});

test("native input generations retain delayed geometry and failure provenance until independent input", async () => {
  const f = fixture(), source = causalActor("plugin:window");
  let inputRevision = 1;
  const read = f.adapter.read;
  f.adapter.read = async () => ({ ...await read(), inputRevision });
  f.adapter.inputRevision = async () => inputRevision;
  await f.service.control({ action: "maximize" }, undefined, source);
  f.viewport.width = 1190;
  expect(eventCause((await f.service.layout())!)).toBe(actorCause(source));
  f.adapter.read = async () => { throw new AppError("ipc/unknown", "Geometry not available"); };
  await expect(f.service.layout()).rejects.toMatchObject({ code: "ipc/unknown" });
  expect(await f.service.layoutOrigin()).toBe(source);
  inputRevision++;
  expect(await f.service.layoutOrigin()).toBeUndefined();
  f.adapter.read = async () => ({ ...await read(), inputRevision });
  // The user can return to the same dimensions between two samples.
  expect(eventCause((await f.service.layout())!)).not.toBe(actorCause(source));
});

test("window intents are bounded, typed, ordered and return observed state rather than a paint claim", async () => {
  const f = fixture();
  for (const bad of [null, {}, { action: "close" }, { action: "fullscreen" }, { action: "fullscreen", enabled: 1 },
    { action: "minimize", label: "other" }, { action: "maximize", x: 0 }]) {
    expect(() => normalizeHostWindowRequest(bad as HostWindowRequest)).toThrow();
  }
  const first = await f.service.snapshot();
  expect(await f.service.snapshot()).toEqual(first);
  const request: HostWindowRequest = { action: "fullscreen", enabled: true };
  const a = f.service.control(request), b = f.service.control({ action: "restore" });
  request.enabled = false;
  expect(await a).toMatchObject({ status: "requested", snapshot: { fullscreen: true } });
  expect(await b).toMatchObject({ status: "requested", snapshot: { fullscreen: false, minimized: false, maximized: false } });
  expect(f.calls).toEqual([{ action: "fullscreen", enabled: true }, { action: "restore" }]);
  const copy = await f.service.snapshot();
  copy.revision = -1; expect((await f.service.snapshot()).revision).toBeGreaterThan(0);
});

test("queued cancellation prevents dispatch, native failures do not poison later intents, and pending requests are capped", async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  const apply = f.adapter.apply;
  f.adapter.apply = async request => { await held.promise; return apply(request); };
  const first = f.service.control({ action: "minimize" });
  const abort = new AbortController();
  const cancelled = f.service.control({ action: "maximize" }, abort.signal).catch(error => error);
  abort.abort(new AppError("plugin/cancelled", "Retired"));
  const rest = Array.from({ length: 30 }, () => f.service.control({ action: "restore" }));
  await expect(f.service.control({ action: "maximize" })).rejects.toMatchObject({ code: "ui/unavailable" });
  held.resolve(); await first; await Promise.all(rest);
  expect(await cancelled).toMatchObject({ code: "plugin/cancelled" });
  expect(f.calls.some(request => request.action === "maximize")).toBe(false);
  f.adapter.apply = async () => { throw new AppError("ipc/unknown", "OS refused"); };
  await expect(f.service.control({ action: "maximize" })).rejects.toMatchObject({ code: "ipc/unknown" });
  f.adapter.apply = apply;
  expect(await f.service.control({ action: "maximize" })).toMatchObject({ snapshot: { maximized: true } });
});

test("observation coalesces slow callbacks, reports read failures and removes the last native watcher", async () => {
  const f = fixture(), values: HostWindowObservation[] = [], held = Promise.withResolvers<void>();
  const stop = f.service.observe(async value => { values.push(value); if (values.length === 1) await held.promise; });
  await tick(); f.state.maximized = true;
  for (let i = 0; i < 20; i++) f.changed();
  await tick(); expect(values).toHaveLength(1);
  held.resolve(); await tick();
  expect(values.at(-1)).toMatchObject({ status: "ready", snapshot: { maximized: true } });
  f.adapter.read = async () => { throw new AppError("ipc/unknown", "private native details"); };
  f.changed(); await tick();
  expect(values.at(-1)).toEqual({ status: "error", code: "ipc/unknown" });
  f.adapter.read = async () => ({ ...f.state });
  f.changed(); await tick(); expect(values.at(-1)?.status).toBe("ready");
  stop(); stop(); expect(f.stops).toBe(1);
  const count = values.length; f.changed(); await tick(); expect(values).toHaveLength(count);
});

test("late watcher setup and late cancelled reads cannot retain listeners or publish a snapshot", async () => {
  const f = fixture(), watch = Promise.withResolvers<() => void>();
  let cleaned = 0, deliveries = 0;
  f.adapter.watch = () => watch.promise;
  const stop = f.service.observe(() => { deliveries++; });
  stop(); watch.resolve(() => { cleaned++; }); await tick();
  expect(cleaned).toBe(1); expect(deliveries).toBe(0);
  const read = Promise.withResolvers<HostWindowState>(), abort = new AbortController();
  f.adapter.read = () => read.promise;
  const pending = f.service.snapshot(abort.signal).catch(error => error);
  await tick(); abort.abort(new AppError("plugin/cancelled", "Retired"));
  read.resolve(f.state); expect(await pending).toMatchObject({ code: "plugin/cancelled" });
});

test("unsupported previews expose no guessed flags; plugin activation gates all operations and owns subscriptions", async () => {
  const plugin = buildPluginContext({ id: "window-test", name: "Window", version: "1", schemaVersion: 1, requires: {}, permissions: [] }, "1", []);
  const window = plugin.context.services.ui.window!;
  expect(() => window.control({ action: "maximize" })).toThrow();
  plugin.lifecycle.promote();
  expect(await window.snapshot()).toMatchObject({ supported: false });
  await expect(window.control({ action: "maximize" })).rejects.toMatchObject({ code: "ui/unavailable" });
  let calls = 0; window.observe(() => { calls++; }); await tick();
  expect(calls).toBe(1);
  plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups();
  expect(() => window.snapshot()).toThrow(); expect(() => window.control({ action: "restore" })).toThrow();
});

test("desktop window capabilities grant the bounded native operations only to main", async () => {
  const root = new URL("../../../desktop/src-tauri/", import.meta.url);
  const capability = await Bun.file(new URL("capabilities/desktop.json", root)).json();
  for (const name of ["minimize", "maximize", "unmaximize", "unminimize", "set-fullscreen",
    "is-minimized", "is-maximized", "is-fullscreen", "is-focused"]) expect(capability.permissions).toContain("core:window:allow-" + name);
  expect(capability.windows).toEqual(["main"]);
});
