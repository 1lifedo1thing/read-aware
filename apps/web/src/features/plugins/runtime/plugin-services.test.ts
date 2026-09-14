import { expect, test } from "bun:test";
import { AppError, type PluginServiceDeclaration } from "@read-aware/core";
import { PluginServiceBroker, serviceExecutionManifest, type PluginServiceParticipant } from "./plugin-services";
import { createPluginBookAccessPolicy } from "../../../domain/plugin-object-access";
import type { PluginBookAccess, PluginManifest } from "@read-aware/plugin-types";
import { withContributionActivation } from "../state/contribution-activation";
const definition: PluginServiceDeclaration = { id: "inspect", version: "1.0.0", title: "Inspect", description: "Read one book", scope: "book", permissions: ["library:read"], input: { type: "null" }, output: { type: "string" } };
function participant(id: string, book: PluginBookAccess = { mode: "all" }, permissions: PluginManifest["permissions"] = ["library:write"]) {
  const abort = new AbortController(), listeners = new Set<(state: { bookId: string; sessionId: string }) => unknown>();
  let current = { bookId: "book", sessionId: "session" }; let tracked = 0;
  const value: PluginServiceParticipant = { manifest: { id, name: id, version: "1.0.0", schemaVersion: 1, permissions, requires: {}, services: [definition] },
    access: createPluginBookAccessPolicy(book, async () => current, handler => { listeners.add(handler); return () => listeners.delete(handler); }, () => current),
    signal: abort.signal, assertLive: () => abort.signal.throwIfAborted(), track: promise => { tracked++; void promise.finally(() => tracked--); }, origin: `plugin:${id}` };
  return { value, abort, listeners, tracked: () => tracked, change: () => { current = { bookId: "other", sessionId: "other" }; for (const listener of listeners) listener(current); } };
}
test("typed calls narrow permissions/settings/network and reject forbidden targets, schemas and stale references", async () => {
  const broker = new PluginServiceBroker(), caller = participant("caller", { mode: "book", bookId: "book" }, ["library:read"]), provider = participant("provider");
  let calls = 0;
  const registration = broker.register(provider.value, async execution => {
    calls++; expect(execution.manifest.permissions).toEqual(["library:read"]); expect(execution.bookAccess).toEqual({ mode: "book", bookId: "book" }); return "result";
  });
  const service = broker.list(caller.value).services[0]!.ref;
  expect((await broker.call(caller.value, { service, bookId: "book", input: null })).value).toBe("result");
  for (const request of [{ service, bookId: "foreign", input: null }, { service, bookId: "book", input: {} }, { service: { ...service, generation: "old" }, bookId: "book", input: null }]) await expect(broker.call(caller.value, request)).rejects.toThrow();
  expect(broker.list(participant("denied", { mode: "all" }, []).value).services).toEqual([]); expect(calls).toBe(1);
  const policy = serviceExecutionManifest({ ...provider.value.manifest, networkAccess: { origins: ["*"] }, settingsAccess: { read: ["reading.*"], write: ["reading.font"] } },
    { ...caller.value.manifest, networkAccess: { origins: ["https://allowed.example"] }, settingsAccess: { read: ["reading.font"], write: [] } }, { ...definition, permissions: ["service:network"] });
  expect(policy.networkAccess?.origins).toEqual(["https://allowed.example"]); expect(policy.settingsAccess).toEqual({ discover: ["reading.font"], read: ["reading.font"], write: [] });
  registration.dispose(); await expect(broker.call(caller.value, { service, bookId: "book", input: null })).rejects.toMatchObject({ code: "plugin/service-unavailable" });
});
test("current-book scopes, cancellation and provider replacement retire late results and drain before releasing capacity", async () => {
  for (const mode of ["caller-book", "provider-book", "caller-stop", "cancel", "update"] as const) {
    const broker = new PluginServiceBroker(), caller = participant("caller", { mode: "current" }), provider = participant("provider", { mode: "current" });
    const entered = Promise.withResolvers<void>(), hold = Promise.withResolvers<void>(); const cancel = new AbortController(); let signal: AbortSignal | undefined;
    const registration = broker.register(provider.value, async execution => { signal = execution.signal; entered.resolve(); await hold.promise; return "late"; });
    const service = broker.list(caller.value).services[0]!.ref;
    const pending = broker.call(caller.value, { service, bookId: "book", input: null }, cancel.signal); await entered.promise;
    if (mode === "caller-book") caller.change(); else if (mode === "provider-book") provider.change();
    else if (mode === "caller-stop") caller.abort.abort(new AppError("plugin/cancelled", "Stopped"));
    else if (mode === "cancel") cancel.abort(new AppError("plugin/cancelled", "Cancelled"));
    else broker.register(provider.value, async () => "replacement");
    expect(signal!.aborted).toBe(true); expect(provider.tracked()).toBe(1);
    hold.resolve(); await expect(pending).rejects.toThrow();
    expect(caller.listeners.size).toBe(0); expect(provider.listeners.size).toBe(0); registration.dispose();
  }
});
test("failed provider activation restores the old contract and recursive calls are rejected", async () => {
  const broker = new PluginServiceBroker(), provider = participant("provider"), caller = participant("caller");
  const registration = broker.register(provider.value, async () => "old"); const service = broker.list(caller.value).services[0]!.ref;
  expect(() => withContributionActivation(() => { const candidate = broker.register(provider.value, async () => "new"); candidate.dispose(); throw Error("Failed activation"); })).toThrow();
  expect((await broker.call(caller.value, { service, bookId: "book", input: null })).value).toBe("old");
  await expect(broker.call({ ...caller.value, lineage: ["provider/inspect"] }, { service, bookId: "book", input: null })).rejects.toMatchObject({ code: "plugin/service-cycle" });
  registration.dispose();
});

test("all exports share provider capacity until cancelled physical work drains, and invalid results are sanitized", async () => {
  const broker = new PluginServiceBroker(), provider = participant("provider");
  provider.value.manifest.services = [definition, { ...definition, id: "other" }];
  const entered = Promise.withResolvers<void>(), hold = Promise.withResolvers<void>(); let count = 0;
  const registration = broker.register(provider.value, async () => { if (++count === 4) entered.resolve(); await hold.promise; return "done"; });
  const callers = Array.from({ length: 5 }, (_, index) => participant(`caller-${index}`));
  const services = broker.list(callers[0]!.value).services;
  const running = callers.slice(0, 4).map((caller, index) => broker.call(caller.value, { service: services[index % 2]!.ref, bookId: "book", input: null }));
  const settled = Promise.allSettled(running); await entered.promise;
  callers[0]!.abort.abort();
  await expect(broker.call(callers[4]!.value, { service: services[1]!.ref, bookId: "book", input: null })).rejects.toMatchObject({ code: "plugin/busy" });
  hold.resolve(); await settled;
  expect((await broker.call(callers[4]!.value, { service: services[0]!.ref, bookId: "book", input: null })).value).toBe("done");
  registration.dispose();
  for (const result of [() => null, () => { throw Error("private error contents"); }]) {
    const registered = broker.register(provider.value, async () => result());
    const service = broker.list(callers[4]!.value).services[0]!.ref;
    const error = await broker.call(callers[4]!.value, { service, bookId: "book", input: null }).catch(error => error);
    expect(error.code).toMatch(/^plugin\/service-(result-invalid|failed)$/); expect(error.message).not.toContain("private error contents");
    registered.dispose();
  }
});
