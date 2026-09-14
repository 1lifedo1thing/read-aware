import { actorCause, causalActor, eventCause, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { expect, test } from "bun:test";
import { HOST_MAINTENANCE_SURFACES, type HostMaintenanceSnapshot, type WorkspaceSettingsSection } from "@read-aware/core";
import { HostMaintenanceService } from "./maintenance-controller";

function fixture() {
  const state: HostMaintenanceSnapshot = { phase: "idle", supported: true, channel: "stable", checkedChannel: null,
    currentVersion: "1.0", availableVersion: null, progress: null, errorStage: null };
  const listeners = new Set<(source: object) => void>(), errors: unknown[] = [];
  const adapter = { snapshot: () => ({ ...state }), check: async () => ({ ...state }), navigate: async (_section: WorkspaceSettingsSection, _signal?: AbortSignal, _origin?: DomainActor) => {},
    subscribe: (handler: (source: object) => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; } };
  const service = new HostMaintenanceService(adapter, error => errors.push(error));
  return { state, listeners, errors, adapter, service, notify: (source = stampEventCause({})) => { for (const h of listeners) h(source); } };
}

test("maintenance opens only mounted host controls after navigation; no export, send or install authority", async () => {
  const f = fixture(), calls: string[] = [];
  await expect(f.service.openSettings("diagnostics")).rejects.toMatchObject({ code: "ui/unavailable" });
  const old = f.service.bindSurface("diagnostics", () => { calls.push("old"); });
  const source = causalActor("plugin:maintenance");
  const off = f.service.bindSurface("diagnostics", origin => { expect(actorCause(origin)).toEqual(actorCause(source)); calls.push("diagnostics"); }); old();
  f.adapter.navigate = async (_section, _signal, origin) => { expect(actorCause(origin)).toEqual(actorCause(source)); calls.push("navigate"); };
  const receipt = await f.service.openSettings("diagnostics", undefined, source);
  expect(receipt).toEqual({ status: "opened", surface: "diagnostics" });
  expect(eventCause(receipt)).toEqual(actorCause(source));
  expect(calls).toEqual(["navigate", "diagnostics"]);
  await expect(f.service.openSettings("send" as never)).rejects.toMatchObject({ code: "ui/invalid-target" });
  const abort = new AbortController(); f.adapter.navigate = async () => { abort.abort(); };
  await expect(f.service.openSettings("diagnostics", abort.signal)).rejects.toThrow();
  expect(calls).toHaveLength(2); off();
});

test("maintenance observation is initial, coalesced, serial and released with no payload mutation", async () => {
  const f = fixture(), release = Promise.withResolvers<void>(), seen: string[] = [];
  const origin = causalActor("plugin:maintenance"), source = stampEventCause({}, origin);
  const causes: unknown[] = [];
  const off = f.service.observe(async state => { causes.push(eventCause(state)); seen.push(state.phase); state.currentVersion = "tampered"; if (seen.length === 1) await release.promise; });
  f.state.phase = "checking"; f.notify(source); f.state.phase = "available"; f.notify(source);
  expect(seen).toEqual(["idle"]); expect((await f.service.snapshot()).currentVersion).toBe("1.0");
  release.resolve(); await Bun.sleep(0); expect(seen).toEqual(["idle", "available"]); expect(causes[1]).toEqual(actorCause(origin));
  off(); off(); expect(f.listeners.size).toBe(0); f.notify(); expect(seen).toHaveLength(2);
  const failing = f.service.observe(() => { throw Error("callback"); });
  await Bun.sleep(0); expect(f.errors).toHaveLength(1); failing();
});

test("all management intents route to their real section and reveal only the registered entry", async () => {
  const f = fixture(), calls: unknown[] = [], signal = new AbortController().signal;
  f.adapter.navigate = async (section, received) => { calls.push([section, received]); };
  const expected = ["about", "about", "plugins", "dataSync", "dataSync", "dataSync", "ai", "dataSync"];
  for (const [index, surface] of HOST_MAINTENANCE_SURFACES.entries()) {
    const off = f.service.bindSurface(surface, () => { calls.push(surface); });
    expect(await f.service.openSettings(surface, signal)).toEqual({ status: "opened", surface });
    expect(calls.splice(0)).toEqual([[expected[index], signal], surface]);
    off();
    await expect(f.service.openSettings(surface, signal)).rejects.toMatchObject({ code: "ui/unavailable" });
    calls.length = 0;
  }
  await expect(f.service.openSettings("delete-data", AbortSignal.abort())).rejects.toBeDefined();
  expect(calls).toEqual([]);
});
