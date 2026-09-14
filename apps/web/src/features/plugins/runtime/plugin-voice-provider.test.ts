import { expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { PluginVoice, PluginVoiceProvider } from "@read-aware/plugin-types";
import { emitAppEvent } from "../../../platform/app-events";
import { voiceProvidersAtom } from "../state/plugin-store";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { registerPluginVoiceProvider } from "./plugin-voice-provider";
import { decodePluginCallbacks, PluginCallbackRegistry } from "./plugin-callback-wire";
import { actorCause, actorFromEvent, saveActorSource, assertReactionAllowed, causalActor, eventCause, reactionActor } from "../../../platform/domain-actor";

const brand = { pluginId: "voice-lifecycle-test", pluginName: "Voice lifecycle test" };
const changed = () => emitAppEvent("plugin-storage-changed", { pluginId: brand.pluginId });
const voices = (id: string): PluginVoice[] => [{ id, label: id }];
const snapshot = () => getDefaultStore().get(voiceProvidersAtom).find(entry => entry.pluginId === brand.pluginId);
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(listVoices: PluginVoiceProvider["listVoices"], synthesize: PluginVoiceProvider["synthesize"] = async () => new Uint8Array()) {
  const lifecycle = new PluginLifecycleController([]);
  const registration = lifecycle.stage(() => registerPluginVoiceProvider({
    id: "main", label: "Main", listVoices, synthesize,
  }, brand, lifecycle));
  return { lifecycle, registration };
}

test("only successful promotion starts voice discovery; synchronous failure is a read failure", async () => {
  let calls = 0;
  const scope = fixture(() => { calls++; throw new Error("provider failed synchronously"); });
  let fail = true;
  scope.lifecycle.stage(() => { if (fail) throw new Error("promotion failed"); return { dispose() {} }; });
  expect(() => scope.lifecycle.promote()).toThrow("promotion failed");
  await turn(); expect(calls).toBe(0); expect(snapshot()).toBeUndefined();
  fail = false;
  scope.lifecycle.promote();
  await turn(); expect(calls).toBe(1); expect(snapshot()?.voices).toEqual([]);
  changed(); await turn(); expect(calls).toBe(2);
  scope.lifecycle.stop();
});

test("settings storms serialize and coalesce queries, suppressing every superseded result", async () => {
  const pending: Array<ReturnType<typeof Promise.withResolvers<PluginVoice[]>>> = [];
  const scope = fixture(() => { const query = Promise.withResolvers<PluginVoice[]>(); pending.push(query); return query.promise; });
  scope.lifecycle.promote(); await turn();
  expect(pending).toHaveLength(1);
  for (let index = 0; index < 100; index++) changed();
  expect(pending).toHaveLength(1);
  pending[0].resolve(voices("old-settings")); await turn();
  expect(snapshot()?.voices).toEqual([]);
  expect(pending).toHaveLength(2);
  pending[1].resolve(voices("latest-settings")); await turn();
  expect(snapshot()?.voices).toEqual(voices("latest-settings"));
  changed(); expect(pending).toHaveLength(3);
  pending[2].reject(new Error("network unavailable")); await turn();
  expect(snapshot()?.voices).toEqual(voices("latest-settings"));
  scope.lifecycle.stop();
});

test("async voice publication merges pending settings causes and disposal uses its actual caller", async () => {
  const pending: Array<ReturnType<typeof Promise.withResolvers<PluginVoice[]>>> = [], store = getDefaultStore();
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const initial = causalActor("plugin:voice"), retirement = causalActor("user");
  const rule = "rule:voice-settings:refresh";
  const setting = reactionActor("plugin:settings", rule, actorCause(causalActor("user"))!);
  const nextSetting = reactionActor("plugin:settings", rule, actorCause(causalActor("user"))!);
  const registration = registerPluginVoiceProvider({ id: "main", label: "Main", listVoices: () => {
    const work = Promise.withResolvers<PluginVoice[]>(); pending.push(work); return work.promise;
  }, synthesize: async () => new Uint8Array() }, brand, lifecycle, initial);
  try {
    expect(eventCause(store.get(voiceProvidersAtom))).toBe(actorCause(initial));
    await turn();
    emitAppEvent("plugin-storage-changed", { pluginId: brand.pluginId }, setting);
    emitAppEvent("plugin-storage-changed", { pluginId: brand.pluginId }, nextSetting);
    pending[0]!.resolve(voices("stale")); await turn();
    expect(snapshot()?.voices).toEqual([]);
    pending[1]!.resolve(voices("current")); await turn();
    expect(saveActorSource(actorFromEvent(store.get(voiceProvidersAtom))).paths).toEqual([
      ...saveActorSource(setting).paths, ...saveActorSource(nextSetting).paths,
    ]);
    expect(() => assertReactionAllowed(eventCause(store.get(voiceProvidersAtom)), rule)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
    registration.dispose(retirement);
    expect(eventCause(store.get(voiceProvidersAtom))).toBe(actorCause(retirement));
  } finally { registration.dispose(); lifecycle.stop(); }
});

test("a settings change from a voice publication observer queues the next revision", async () => {
  let calls = 0;
  const scope = fixture(() => voices(String(++calls)));
  let changedOnce = false;
  const unsubscribe = getDefaultStore().sub(voiceProvidersAtom, () => {
    if (snapshot()?.voices[0]?.id === "1" && !changedOnce) { changedOnce = true; changed(); }
  });
  scope.lifecycle.promote(); await turn();
  expect(calls).toBe(2);
  expect(snapshot()?.voices).toEqual(voices("2"));
  unsubscribe(); scope.lifecycle.stop();
});

test("disposal and lifecycle cancellation discard pending voice results and queued refreshes", async () => {
  for (const cancel of ["dispose", "abort"] as const) {
    const pending = Promise.withResolvers<PluginVoice[]>();
    let calls = 0;
    const scope = fixture(() => { calls++; return pending.promise; });
    scope.lifecycle.promote(); await turn(); changed();
    if (cancel === "dispose") scope.registration.dispose();
    else scope.lifecycle.cancelOperations();
    pending.resolve(voices("late")); await turn(); changed(); await turn();
    expect(calls).toBe(1); expect(snapshot()).toBeUndefined();
    scope.lifecycle.stop();
  }
});

test("successful replacement silences old refreshes; failed replacement preserves the old query", async () => {
  const pending = Promise.withResolvers<PluginVoice[]>();
  let calls = 0;
  const old = fixture(() => { calls++; return pending.promise; });
  old.lifecycle.promote(); await turn();
  const failed = fixture(() => voices("invalid-candidate"));
  failed.lifecycle.stage(() => { throw new Error("failed"); });
  expect(() => failed.lifecycle.promote()).toThrow("failed");
  pending.resolve(voices("old-restored")); await turn();
  expect(snapshot()?.voices).toEqual(voices("old-restored"));
  const next = fixture(() => voices("replacement"));
  next.lifecycle.promote(); await turn(); changed(); await turn();
  expect(calls).toBe(1);
  expect(snapshot()?.voices).toEqual(voices("replacement"));
  old.lifecycle.stop(); failed.lifecycle.stop();
  expect(snapshot()?.voices).toEqual(voices("replacement"));
  next.lifecycle.stop();
});

test.each(["accepted", "superseded", "malformed", "disposed"])("%s voice results release every returned callback without retaining extensions", async mode => {
  const callbacks = new PluginCallbackRegistry();
  const pending = Promise.withResolvers<PluginVoice[]>();
  let calls = 0;
  const scope = fixture(() => ++calls === 1 ? pending.promise : voices("latest"));
  scope.lifecycle.promote(); await turn();
  const value = mode === "malformed" ? { unexpected: () => {} }
    : [{ id: "wire", label: { default: "Wire", translations: { zh: "声音" } }, languages: ["en"], unexpected: () => {} }];
  const raw = decodePluginCallbacks(callbacks.encode(value), (handle, args) => callbacks.invoke(handle, args), handles => callbacks.release(handles)) as PluginVoice[];
  expect(callbacks.size).toBe(1);
  if (mode === "superseded") changed();
  if (mode === "disposed") scope.registration.dispose();
  pending.resolve(raw); await turn();
  expect(callbacks.size).toBe(0);
  if (mode === "accepted") {
    expect(snapshot()?.voices).toEqual([{ id: "wire", label: { default: "Wire", translations: { zh: "声音" } }, languages: ["en"] }]);
    raw[0].id = "mutated";
    expect(snapshot()?.voices[0].id).toBe("wire");
  } else if (mode === "superseded") expect(snapshot()?.voices).toEqual(voices("latest"));
  else if (mode === "malformed") expect(snapshot()?.voices).toEqual([]);
  else expect(snapshot()).toBeUndefined();
  scope.lifecycle.stop();
});

test.each(["settings", "replace", "dispose", "invalid"])("synthesis %s rejects stale or malformed bytes and releases returned callbacks", async mode => {
  const pending = Promise.withResolvers<ArrayBuffer | Uint8Array>();
  const callbacks = new PluginCallbackRegistry();
  let calls = 0;
  const scope = fixture(() => voices("first"), () => { calls++; return pending.promise; });
  scope.lifecycle.promote(); await turn();
  const old = snapshot()!;
  const input = { text: "A sentence", voiceId: "first" };
  const synthesis = old.synthesize(input).catch(error => error);
  let replacement: ReturnType<typeof fixture> | undefined;
  if (mode === "settings") changed();
  if (mode === "replace") { replacement = fixture(() => voices("next")); replacement.lifecycle.promote(); }
  if (mode === "dispose") scope.registration.dispose();
  const unexpected = decodePluginCallbacks(callbacks.encode({ cleanup: () => {} }), (handle, args) => callbacks.invoke(handle, args), handles => callbacks.release(handles));
  pending.resolve(unexpected as Uint8Array);
  expect(await synthesis).toMatchObject({ code: mode === "invalid" ? "plugin/invalid-input" : "plugin/unavailable" });
  expect(callbacks.size).toBe(0);
  if (mode === "replace" || mode === "dispose") {
    await expect(old.synthesize(input)).rejects.toMatchObject({ code: "plugin/unavailable" });
    expect(calls).toBe(1);
  }
  scope.lifecycle.stop(); replacement?.lifecycle.stop();
});
