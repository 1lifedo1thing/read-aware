import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { decodePluginCallbacks, PluginCallbackRegistry, pluginCallbackOwner, releasePluginCallbacks } from "./plugin-callback-wire";
import { pluginCallbackInvoker } from "./plugin-callback-results";
import { PluginScheduleController, type ScheduleRecord } from "./plugin-schedule-controller";

function result(value: unknown) {
  const callbacks = new PluginCallbackRegistry();
  return { callbacks, value: decodePluginCallbacks(callbacks.encode(value), (handle, args) => callbacks.invoke(handle, args), handles => callbacks.release(handles)) };
}

test("schedule completion waits for the callback, releases its result and preserves failure semantics", async () => {
  const saved = new Map<string, Record<string, ScheduleRecord>>();
  const controller = new PluginScheduleController({ read: key => saved.get(key) ?? {}, write: async (key, value) => { saved.set(key, value); } }, () => {});
  const pending = Promise.withResolvers<unknown>();
  const remote = pluginCallbackInvoker("services.schedules.bind", () => pending.promise);
  const registration = controller.register("result-test", { id: "run", label: "Run", everyMinutes: 60 }, async () => { await remote("h1", []); });
  const command = { pluginId: "result-test", id: "run", action: "run" } as const;
  const running = controller.control(command);
  await Bun.sleep(0);
  expect(controller.list().schedules[0]?.lastOutcome).toBe("running");
  const payload = result({ extra: () => {} }); pending.resolve(payload.value);
  expect(await running).toMatchObject({ status: "completed" });
  expect(payload.callbacks.size).toBe(0);
  registration.dispose();
  const failure = new AppError("sync/network", "Callback failed");
  const failed = controller.register("result-test", { id: "run", label: "Run", everyMinutes: 60 }, async () => {
    await pluginCallbackInvoker("services.schedules.bind", async () => { throw failure; })("h2", []);
  });
  await expect(controller.control(command)).rejects.toMatchObject({ code: "sync/network" });
  expect(controller.list().schedules[0]?.lastOutcome).toBe("failed");
  failed.dispose();
});

test("streaming notification returns are discarded without changing callback ownership", async () => {
  const source = new PluginCallbackRegistry(), lifetime = new AbortController();
  const payload = result({ unexpected: () => {} });
  const callback = decodePluginCallbacks(source.encode(() => {}), pluginCallbackInvoker("services.llm.askDetailed", async () => payload.value),
    handles => source.release(handles), lifetime.signal) as () => Promise<unknown>;
  expect(pluginCallbackOwner(callback)).toBe(lifetime.signal);
  expect(await callback()).toBeUndefined();
  expect(payload.callbacks.size).toBe(0);
  expect(source.size).toBe(1);
  releasePluginCallbacks(callback); expect(source.size).toBe(0);
});

test.each(["contributions.commands.register", "contributions.agentTools.register", "services.ui.publishView", "contributions.contentProviders.register"])("%s keeps returned callbacks for its actual consumer", async method => {
  const payload = result({ action: () => "kept" });
  const value = await pluginCallbackInvoker(method, async () => payload.value)("h1", []);
  expect(value).toBe(payload.value); expect(payload.callbacks.size).toBe(1);
  expect(await (value as { action(): unknown }).action()).toBe("kept");
  releasePluginCallbacks(value); expect(payload.callbacks.size).toBe(0);
});
