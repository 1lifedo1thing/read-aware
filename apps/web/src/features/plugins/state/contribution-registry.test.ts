import { describe, expect, test } from "bun:test";
import { createContributionRegistry } from "./contribution-registry";
import { getDefaultStore } from "jotai";
import { withContributionActivation } from "./contribution-activation";
import { actorCause, causalActor, eventCause } from "../../../platform/domain-actor";

describe("contribution registry", () => {
  test("settled publications keep operation sources, retire rolled-back causes and ignore no-op updates", () => {
    const registry = createContributionRegistry<{ key: string; pluginId: string; value: number }>("commands", { catalog: false });
    const store = getDefaultStore(), seen: object[] = [];
    const off = store.sub(registry.atom, () => { seen.push(store.get(registry.atom)); });
    const first = causalActor("plugin:source"), failed = causalActor("plugin:failed"), next = causalActor("user"), retirement = causalActor("plugin:retirement");
    const registration = registry.register({ key: "source:main", pluginId: "source", value: 0 }, first);
    try {
      expect(eventCause(seen.at(-1)!)).toBe(actorCause(first));
      expect(() => withContributionActivation(() => {
        registry.register({ key: "source:main", pluginId: "source", value: 9 }, failed);
        throw Error("activation failed");
      })).toThrow("activation failed");
      expect(seen).toHaveLength(1);
      registry.update("source:main", item => item, failed);
      registry.update("source:missing", item => item, failed);
      expect(seen).toHaveLength(1);
      registry.update("source:main", item => ({ ...item, value: 2 }), next);
      expect(eventCause(seen.at(-1)!)).toBe(actorCause(next));
      withContributionActivation(() => {
        registry.update("source:main", item => ({ ...item, value: 3 }), next);
        expect(() => withContributionActivation(() => {
          const failedRegistration = registry.register({ key: "source:main", pluginId: "source", value: 10 }, failed);
          failedRegistration.dispose();
          throw Error("nested failed");
        })).toThrow("nested failed");
      });
      expect(eventCause(seen.at(-1)!)).toBe(actorCause(next));
      expect(store.get(registry.atom)[0]?.value).toBe(3);
      registration.dispose(retirement);
      expect(eventCause(seen.at(-1)!)).toBe(actorCause(retirement));
      expect(store.get(registry.atom)).toEqual([]);
      expect(JSON.stringify(seen)).not.toContain("cause");
    } finally { registration.dispose(); off(); }
  });
  test("refreshing immutable contribution data retains its original disposal owner", () => {
    const registry = createContributionRegistry<{ key: string; pluginId: string; value: number }>("voiceProviders", { catalog: false });
    const registration = registry.register({ key: "voice:main", pluginId: "voice", value: 0 });
    registry.update("voice:main", entry => ({ ...entry, value: 1 }));
    registry.update("voice:main", entry => ({ ...entry, value: 2 }));
    registration.dispose(); registration.dispose();
    expect(registry.list()).toEqual([]);
  });

  test("old disposal never removes a replacement even after both entries were refreshed", () => {
    const registry = createContributionRegistry<{ key: string; pluginId: string; value: number }>("voiceProviders", { catalog: false });
    const old = registry.register({ key: "voice:main", pluginId: "voice", value: 0 });
    registry.update("voice:main", entry => ({ ...entry, value: 1 }));
    const current = registry.register({ key: "voice:main", pluginId: "voice", value: 2 });
    registry.update("voice:main", entry => ({ ...entry, value: 3 }));
    old.dispose();
    expect(registry.list()[0]?.value).toBe(3);
    current.dispose();
    expect(registry.list()).toEqual([]);
  });

  test("re-registering the exact same value still publishes the new owner and its cause", () => {
    const registry = createContributionRegistry("commands", { catalog: false }), store = getDefaultStore();
    const item = { key: "same:main", pluginId: "same" }, source = causalActor("plugin:same");
    const old = registry.register(item);
    const before = store.get(registry.atom), replacement = registry.register(item, source);
    try {
      expect(store.get(registry.atom)).not.toBe(before);
      expect(eventCause(store.get(registry.atom))).toBe(actorCause(source));
      old.dispose(); expect(registry.list()).toEqual([item]);
    } finally { replacement.dispose(); }
  });

  test("an update cannot change the key or declaring plugin", () => {
    const registry = createContributionRegistry("voiceProviders", { catalog: false });
    const registration = registry.register({ key: "voice:main", pluginId: "voice" });
    expect(() => registry.update("voice:main", entry => ({ ...entry, key: "voice:other" }))).toThrow("cannot transfer");
    expect(() => registry.update("voice:main", entry => ({ ...entry, pluginId: "other" }))).toThrow("cannot transfer");
    expect(registry.list()).toEqual([{ key: "voice:main", pluginId: "voice" }]);
    registration.dispose();
    expect(registry.list()).toEqual([]);
  });
  test("a stale disposable cannot remove a replacement with the same key", () => {
    const registry = createContributionRegistry<{
      key: string;
      pluginId: string;
      value: number;
    }>("commands", { catalog: false });
    const stale = registry.register({ key: "test:item", pluginId: "test", value: 1 });
    registry.register({ key: "test:item", pluginId: "test", value: 2 });

    stale.dispose();

    expect(registry.list()).toEqual([
      { key: "test:item", pluginId: "test", value: 2 },
    ]);
  });

  test("rejects keys outside the declaring plugin namespace", () => {
    const registry = createContributionRegistry("agentTools", { catalog: false });
    expect(() =>
      registry.register({ key: "other:item", pluginId: "test" }),
    ).toThrow(/owned by plugin/);
  });
});
