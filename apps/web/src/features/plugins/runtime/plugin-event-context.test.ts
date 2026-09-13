import { expect, spyOn, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { buildPluginContext } from "./plugin-context";
import { actorCause, eventCause, stampEventCause } from "../../../platform/domain-actor";
import { readingRuntime } from "../../../domain/reading-runtime";
import * as resources from "../../../services/resources";
import { createSettingsDomain } from "../../../domain/settings/domain";
import { deferred } from "../../../../tests/helpers/entity-host";

test("event contexts retain the activation's permissions and resource owner, and stamp real reading commands across await", async () => {
  const makeOwner = resources.createResourceOwner;
  const owner = spyOn(resources, "createResourceOwner").mockImplementation((...args) => makeOwner(...args));
  const runtime = buildPluginContext({ id: "reaction-context", name: "Reaction", version: "1", schemaVersion: 1, requires: {},
    permissions: ["reading:write"] }, "1", []);
  let retained!: PluginContext;
  const session = readingRuntime.begin("b");
  readingRuntime.attach(session, { navigate: async target => ({ bookId: "b", contentVersion: "v", cfi: target.cfi ?? "start" }),
    step: async () => ({ bookId: "b", contentVersion: "v", cfi: "step" }) }, { bookId: "b", contentVersion: "v", cfi: "start" });
  try {
    runtime.lifecycle.promote();
    const event = stampEventCause({}), root = eventCause(event)!.root;
    await runtime.reactions.deliver({}, event, async reaction => {
      retained = runtime.context.withEvent({ reaction });
      expect(retained.domains.library).toBeUndefined();
      expect(retained.grants).toBe(runtime.context.grants);
      expect(retained.lifecycle).toBe(runtime.context.lifecycle);
      await Promise.resolve();
      await retained.domains.reading!.commands!.goTo({ cfi: "from-event" });
      expect(eventCause(readingRuntime.snapshot())!.root).toBe(root);
      expect(readingRuntime.snapshot().change?.origin).toBe("plugin:reaction-context");
      const other = runtime.context.withEvent({ reaction });
      expect(other.services.llm).toBeUndefined();
      expect(owner).toHaveBeenCalledTimes(1);
      expect(() => retained.services.storage.collection("notes")).not.toThrow();
    });
    const before = readingRuntime.snapshot();
    expect(() => retained.domains.reading!.commands!.goTo({ cfi: "expired" })).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
    expect(readingRuntime.snapshot()).toEqual(before);
    await runtime.context.domains.reading!.commands!.goTo({ cfi: "user-intent" });
    expect(eventCause(readingRuntime.snapshot())!.root).not.toBe(root);
  } finally { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); readingRuntime.closed(); owner.mockRestore(); }
});

test("authorized settings subscriptions preserve provenance and keep the lease live until the returned callback promise settles", async () => {
  const restoreStorage = memoryStorage();
  const path = "appearance.theme";
  const runtime = buildPluginContext({ id: "reaction-settings", name: "Settings", version: "1", schemaVersion: 1, requires: {},
    settingsAccess: { read: [path], write: [path] } }, "1", []);
  const settings = createSettingsDomain("user"), entered = deferred(), gate = deferred(), finished = deferred();
  const previous = (await settings.queries.read(path)).value;
  let retained!: PluginContext, root: string | undefined;
  try {
    runtime.lifecycle.promote();
    const subscription = runtime.context.domains.settings.events.subscribe(async event => {
      retained = runtime.context.withEvent(event);
      root = actorCause(runtime.reactions.actor(event.reaction!))!.root;
      entered.resolve(); await gate.promise;
      expect(retained.services.storage.get("unset")).toBeNull();
      finished.resolve();
    });
    await settings.commands.update([{ path, value: previous === "dark" ? "light" : "dark" }]);
    await entered.promise; expect(root).toBeString();
    expect(retained.services.storage.get("unset")).toBeNull();
    gate.resolve(); await finished.promise; await Bun.sleep(0);
    expect(() => retained.services.storage.get("unset")).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
    subscription.dispose();
  } finally { gate.resolve(); runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); await settings.commands.update([{ path, value: previous }]);
    restoreStorage();
  }
});

function memoryStorage() {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key), key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } });
  return () => {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

test("two public plugin settings reactions stop A to B to A and preserve a new user's independent root", async () => {
  const restoreStorage = memoryStorage(), settings = createSettingsDomain("user");
  const theme = (await settings.queries.read("appearance.theme")).value;
  const motion = (await settings.queries.read("appearance.motion")).value;
  const make = (id: string, read: string, write: string) => {
    const runtime = buildPluginContext({ id, name: id, version: "1", schemaVersion: 1, requires: {},
      settingsAccess: { read: [read], write: [write] } }, "1", []);
    runtime.lifecycle.promote(); return runtime;
  };
  const a = make("causal-a", "appearance.theme", "appearance.motion"), b = make("causal-b", "appearance.motion", "appearance.theme");
  let done = deferred(), cycles = 0, motionValue = motion, themeValue = theme;
  const roots: string[] = [];
  try {
    a.context.domains.settings.events.subscribe(async event => {
      if (!event.changes.some(change => change.path === "appearance.theme")) return;
      if (event.reaction?.status === "cycle") {
        expect(() => a.context.withEvent(event)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
        cycles++; done.resolve(); return;
      }
      const bound = a.context.withEvent(event);
      roots.push(actorCause(a.reactions.actor(event.reaction!))!.root);
      motionValue = motionValue === "reduced" ? "system" : "reduced";
      await Promise.resolve();
      await bound.domains.settings.commands.update([{ path: "appearance.motion", value: motionValue }]);
    });
    b.context.domains.settings.events.subscribe(async event => {
      if (!event.changes.some(change => change.path === "appearance.motion")) return;
      const bound = b.context.withEvent(event);
      // Undo the user's theme change; this publishes the event back to A.
      await bound.domains.settings.commands.update([{ path: "appearance.theme", value: themeValue }]);
    });
    for (let i = 0; i < 2; i++) {
      done = deferred(); themeValue = (await settings.queries.read("appearance.theme")).value;
      await settings.commands.update([{ path: "appearance.theme", value: themeValue === "dark" ? "light" : "dark" }]);
      await done.promise; await Promise.all([a.reactions.drain(), b.reactions.drain()]);
    }
    expect(cycles).toBe(2); expect(roots).toHaveLength(2); expect(roots[0]).not.toBe(roots[1]);
  } finally {
    a.lifecycle.stop(); b.lifecycle.stop(); await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]);
    await settings.commands.update([{ path: "appearance.theme", value: theme }, { path: "appearance.motion", value: motion }]);
    restoreStorage();
  }
});
