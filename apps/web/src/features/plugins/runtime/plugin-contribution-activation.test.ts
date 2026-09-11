import { expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { createContributionRegistry } from "../state/contribution-registry";
import { createInteractiveContributionRegistry } from "../state/interactive-contribution-registry";
import { withContributionActivation } from "../state/contribution-activation";
import { PluginLifecycleController } from "./plugin-lifecycle";

const fixture = () => createContributionRegistry<{ key: string; pluginId: string; value: number }>("voiceProviders", { catalog: false });
const item = (value: number) => ({ key: "probe:main", pluginId: "probe", value });

test("failed promotion restores the exact old entry and owner without exposing candidates", () => {
  const registry = fixture();
  const old = registry.register(item(0));
  registry.update("probe:main", entry => ({ ...entry, value: 1 }));
  const original = registry.list()[0];
  const observed: number[][] = [];
  const unsubscribe = getDefaultStore().sub(registry.atom, () => {
    observed.push(getDefaultStore().get(registry.atom).map(entry => entry.value));
  });
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.stage(() => registry.register(item(2)));
  lifecycle.stage(() => registry.register(item(3)));
  let fail = true;
  lifecycle.stage(() => { if (fail) throw new Error("later factory failed"); return { dispose() {} }; });
  expect(() => lifecycle.promote()).toThrow("later factory failed");
  expect(registry.list()).toEqual([original]);
  expect(registry.list()[0]).toBe(original);
  expect(observed).toEqual([]);
  fail = false;
  lifecycle.promote();
  expect(observed).toEqual([[3]]);
  old.dispose();
  expect(registry.list()[0].value).toBe(3);
  lifecycle.stop();
  expect(registry.list()).toEqual([]);
  unsubscribe();
});

test("a factory that throws before returning its disposable still restores its replacement", () => {
  const registry = fixture();
  const old = registry.register(item(1));
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.promote();
  expect(() => lifecycle.stage(() => {
    registry.register(item(2));
    throw new Error("factory failed");
  })).toThrow("factory failed");
  expect(registry.list()[0].value).toBe(1);
  old.dispose();
  expect(registry.list()).toEqual([]);
  lifecycle.stop();
});

test("caught nested failure restores its parent replacement, outer failure restores the original", () => {
  const registry = fixture();
  const old = registry.register(item(1));
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.stage(() => {
    const parent = registry.register(item(2));
    expect(() => lifecycle.stage(() => {
      registry.register(item(3));
      throw new Error("child failed");
    })).toThrow("child failed");
    expect(registry.list()[0].value).toBe(2);
    return parent;
  });
  lifecycle.stage(() => { throw new Error("outer failed"); });
  expect(() => lifecycle.promote()).toThrow("outer failed");
  expect(registry.list()[0].value).toBe(1);
  lifecycle.stop();
  old.dispose();
});

test("rollback never resurrects an old registration explicitly disposed during activation", () => {
  const registry = fixture();
  const old = registry.register(item(1));
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.stage(() => registry.register(item(2)));
  lifecycle.stage(() => { old.dispose(); throw new Error("failed"); });
  expect(() => lifecycle.promote()).toThrow("failed");
  expect(registry.list()).toEqual([]);
  expect(getDefaultStore().get(registry.atom)).toEqual([]);
  lifecycle.stop();
});

test("runtime and manifest registries share the outer promotion rollback boundary", () => {
  const commands = fixture(), themes = fixture();
  const oldCommand = commands.register(item(1)), oldTheme = themes.register(item(1));
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.stage(() => commands.register(item(2)));
  expect(() => withContributionActivation(() => {
    lifecycle.promote();
    themes.register(item(2));
    throw new Error("manifest contribution failed");
  })).toThrow("manifest contribution failed");
  expect(commands.list()[0].value).toBe(1);
  expect(themes.list()[0].value).toBe(1);
  lifecycle.stop();
  expect(commands.list()[0].value).toBe(1);
  oldCommand.dispose(); oldTheme.dispose();
});

test("restored actions retain their exact state, callback and state-update authority", async () => {
  const registry = createInteractiveContributionRegistry<{
    key: string; pluginId: string; run(): string;
    state?: { revision: number; enabled: boolean; visible: boolean; checked?: boolean };
  }>("commands", "run", { catalog: false });
  const old = registry.register({ ...item(1), run: () => "old" });
  await old.updateState({ revision: 7, enabled: false, visible: true, checked: true });
  const original = registry.list()[0];
  const lifecycle = new PluginLifecycleController([]);
  let candidate: (() => string) | undefined;
  lifecycle.stage(() => {
    const registration = registry.register({ ...item(2), run: () => "new" });
    candidate = registry.list()[0].run;
    return registration;
  });
  lifecycle.stage(() => { throw new Error("failed"); });
  expect(() => lifecycle.promote()).toThrow("failed");
  expect(registry.list()[0]).toBe(original);
  expect(original.run).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
  expect(candidate).toThrow(expect.objectContaining({ code: "plugin/unavailable" }));
  expect(await old.updateState({ revision: 8, enabled: true, visible: true })).toEqual({ status: "applied" });
  expect(original.run()).toBe("old");
  lifecycle.stop(); old.dispose();
});
