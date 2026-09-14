import { afterEach, expect, spyOn, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { hostIO } from "./host-io";
import { pluginDirectory, pluginDirectoryPage } from "./plugin-directory";
import { installedPluginsAtom } from "../features/plugins/state/plugin-store";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function actor(permissions: PluginPermission[]) {
  const runtime = buildPluginContext({ id: "host-io-test", name: "Host IO", version: "1.0.0", schemaVersion: 1, requires: {}, permissions }, "0.5.4", []);
  runtime.lifecycle.promote(); cleanups.push(() => runtime.lifecycle.stop()); return runtime;
}
test("plugin clipboard and external links require grants and stop accepting work on retirement", async () => {
  const empty = actor([]).context.services;
  expect(empty.clipboard).toBeUndefined(); expect(empty.ui.openExternal).toBeUndefined();
  expect(empty.plugins.list).toBeFunction();
  const calls: unknown[] = [];
  const clipboard = spyOn(hostIO, "writeClipboard").mockImplementation(async (...args) => { calls.push(args); });
  const external = spyOn(hostIO, "openExternal").mockImplementation(async (...args) => { calls.push(args); });
  cleanups.push(() => clipboard.mockRestore(), () => external.mockRestore());
  const runtime = actor(["service:clipboard", "service:network"]);
  await runtime.context.services.clipboard!.writeText("requested");
  await runtime.context.services.ui.openExternal!("https://example.com/");
  expect(calls).toEqual([["requested", runtime.lifecycle.signal], ["https://example.com/", runtime.lifecycle.signal]]);
  runtime.lifecycle.stop();
  expect(() => runtime.context.services.clipboard!.writeText("late")).toThrow();
  expect(() => runtime.context.services.ui.openExternal!("https://example.com/")).toThrow();
  await expect(runtime.context.services.plugins.list()).rejects.toThrow();
});
test("plugin directory projects only public metadata and observers release", async () => {
  const store = getDefaultStore(), original = store.get(installedPluginsAtom);
  cleanups.push(() => store.set(installedPluginsAtom, original));
  const installed = [{ manifest: { id: "desk", name: "A desk", version: "1.0.0", schemaVersion: 1,
    description: "PRIVATE", settings: { password: "SECRET" } }, enabled: true, error: "RAW SECRET" }];
  const page = pluginDirectoryPage(installed as never, { limit: 1 });
  expect(page.plugins).toEqual([{ id: "desk", name: "A desk", version: "1.0.0", builtin: false, enabled: true, activationFailed: true }]);
  expect(JSON.stringify(page)).not.toMatch(/PRIVATE|SECRET|password/);
  const pages: unknown[] = [];
  store.set(installedPluginsAtom, []);
  const off = pluginDirectory.observe({}, value => pages.push(value));
  store.set(installedPluginsAtom, installed as never);
  expect(pages).toHaveLength(2); off(); store.set(installedPluginsAtom, []); expect(pages).toHaveLength(2);
  expect((await pluginDirectory.list()).total).toBe(0);
});


test("IO availability enforces grants without effects and rechecks clipboard entry at dispatch", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator"), copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied.push(text); } } } });
  cleanups.push(() => { if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else Reflect.deleteProperty(globalThis, "navigator"); });
  const denied = actor([]).context.services.session;
  expect((await denied.operationAvailability({ operation: "clipboard.writeText", text: "private" })).conditions).toEqual([
    { kind: "permission", state: "unavailable", reason: "service:clipboard-required" },
  ]);
  expect((await denied.operationAvailability({ operation: "ui.openExternal", url: "https://example.com" })).conditions).toEqual([
    { kind: "permission", state: "unavailable", reason: "service:network-required" },
  ]);
  const allowed = actor(["service:clipboard"]).context.services;
  const availability = await allowed.session.operationAvailability({ operation: "clipboard.writeText", text: "private" });
  expect(availability.state).toBe("unknown"); expect(JSON.stringify(availability)).not.toContain("private"); expect(copied).toEqual([]);
  await allowed.clipboard!.writeText("requested"); expect(copied).toEqual(["requested"]);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  expect((await allowed.session.operationAvailability({ operation: "clipboard.writeText", text: "later" })).state).toBe("unavailable");
  await expect(allowed.clipboard!.writeText("later")).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(copied).toEqual(["requested"]);
});


test("export inspection opens no dialog and execution rechecks its entry", async () => {
  const services = actor([]).context.services;
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const invoke = () => { throw Error("inspection must not call native IO"); };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: { invoke } } });
  cleanups.push(() => { if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window"); });
  const snapshot = await services.session.operationAvailability({ operation: "ui.exportFile", filename: "private.txt", byteLength: 3 });
  expect(snapshot.state).toBe("unknown"); expect(JSON.stringify(snapshot)).not.toContain("private.txt");
  expect(() => services.session.operationAvailability({ operation: "ui.exportFile", filename: "x", byteLength: 67108865 })).toThrow();
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  expect((await services.session.operationAvailability({ operation: "ui.exportFile", filename: "x", byteLength: 0 })).state).toBe("unavailable");
  expect(() => services.ui.exportFile({ filename: "x", content: "文" })).toThrow();
});
