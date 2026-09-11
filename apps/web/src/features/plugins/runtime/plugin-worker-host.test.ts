import { describe, expect, spyOn, test } from "bun:test";
import type { PluginContext, PluginDisposable } from "../lib/plugin-types";
import { getDefaultStore } from "jotai";
import { contextActionsAtom, pluginCommandsAtom, voiceProvidersAtom } from "../state/plugin-store";
import { emitAppEvent } from "../../../platform/app-events";
import { localKV } from "../../../platform/local-store";
import { describeContext, startPluginWorker } from "./plugin-worker-host";
import { PluginCallbackRegistry, pluginCallbackOwner, retainPluginCallbacks } from "./plugin-callback-wire";
import { openPluginViewChannel } from "../lib/plugin-view-channels";
import { PluginLifecycleController } from "./plugin-lifecycle";
import * as runtimeModule from "../../ai/agent/agent-runtime";
import type { AgentRuntime, OneShotInput } from "@read-aware/agent";
import type { PluginPermission } from "@read-aware/core";
import * as contentNavigation from "../../library/lib/book-content-navigation";
import { readingRuntime } from "../../../domain/reading-runtime";
import * as entityDomain from "../../../domain/entity-registry";
import * as identityDomain from "../../../domain/identity-consolidation";
import * as contextAccess from "../../../domain/context-bundle-access";
import { AppError } from "@read-aware/core";
import { identityHost } from "../../../../tests/helpers/identity-host";
import { deferred, entityHost, entityRevision } from "../../../../tests/helpers/entity-host";
import { PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";
import { pluginHostBudget, pluginTrafficBudget, PLUGIN_HOST_LIMITS, PluginTrafficBudget } from "./plugin-host-budget";

test.each(["read", "before-write", "committed", "conflict"])("entity Worker RPC %s keeps cancellation and native receipt boundaries", async mode => {
  const host = entityHost(), entered = deferred(), gate = deferred();
  const wait = () => { entered.resolve(); return gate.promise; };
  if (mode === "read") host.controls.beforeRead = wait;
  else if (mode === "before-write") host.controls.beforeMint = wait;
  else host.controls.beforeCommit = async () => {
    await wait();
    if (mode === "conflict") throw Object.assign(new Error("Native conflict"), { code: "memory/conflict" });
  };
  const spies = [spyOn(entityDomain, "queryEntities").mockImplementation(host.service.query), spyOn(entityDomain, "decideEntity").mockImplementation(host.service.decide)];
  const { worker, close } = await hostFixture(["memory:write"]);
  try {
    const method = mode === "read" ? "domains.memory.queries.entities" : "domains.memory.commands.decideEntity";
    const input = mode === "read" ? { kind: "identities" } : { op: "merge", keepId: "one", mergedId: "two", expectedRevision: entityRevision };
    const call = worker.deliver({ t: "call", id: 995, method, args: worker.callbacks.encode([input, { signal: { forged: true } }]) });
    await entered.promise; await worker.deliver({ t: "cancel", id: 995 });
    gate.resolve(); await call;
    const response = worker.sent.find(message => message.t === "result" && message.id === 995);
    if (mode === "committed") expect(response).toMatchObject({ ok: true, value: host.controls.receipt });
    else expect(response).toMatchObject({ ok: false, code: mode === "conflict" ? "memory/conflict" : "plugin/cancelled" });
    expect(host.broadcasts).toHaveLength(mode === "committed" ? 1 : 0);
    if (mode === "before-write") expect(host.calls).toHaveLength(0);
  } finally { gate.resolve(); await close(); for (const spy of spies) spy.mockRestore(); }
});

type WireMessage = { t: string; id?: number; handle?: string; handles?: string[]; disposable?: string; [key: string]: unknown };

test.each(["calls", "registrations", "callbacks"] as const)("global %s capacity rejects before contribution replacement and recovers", async kind => {
  const { worker, close } = await hostFixture();
  const baseline = pluginHostBudget.snapshot();
  const occupied = pluginHostBudget.reserve(kind, PLUGIN_HOST_LIMITS[kind] - baseline[kind]);
  try {
    await worker.deliver({ t: "call", id: 980, method: "contributions.commands.register",
      args: worker.callbacks.encode([{ id: "global-capacity", title: "Rejected", run: () => null }]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 980)).toMatchObject({ ok: false, code: "plugin/busy" });
    expect(getDefaultStore().get(pluginCommandsAtom).some(command => command.id === "global-capacity")).toBe(false);
    occupied.release();
    await worker.deliver({ t: "call", id: 981, method: "contributions.commands.register",
      args: worker.callbacks.encode([{ id: "global-capacity", title: "Recovered", run: () => null }]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 981)).toMatchObject({ ok: true });
    expect(pluginHostBudget.snapshot()).toMatchObject({ calls: baseline.calls, registrations: baseline.registrations + 1, callbacks: baseline.callbacks + 1 });
  } finally { occupied.release(); await close(); }
  expect(pluginHostBudget.snapshot()).toEqual(baseline);
});

test("global outgoing invoke quota does not dispatch a callback and releases after the real result", async () => {
  const { worker, close } = await hostFixture();
  const baseline = pluginHostBudget.snapshot();
  const occupied = pluginHostBudget.reserve("invokes", PLUGIN_HOST_LIMITS.invokes - baseline.invokes);
  try {
    await worker.deliver({ t: "call", id: 982, method: "contributions.commands.register",
      args: worker.callbacks.encode([{ id: "invoke-capacity", title: "Invoke", run: () => null }]) });
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "invoke-capacity")!;
    await expect(Promise.resolve(command.run())).rejects.toMatchObject({ code: "plugin/busy" });
    expect(worker.sent.filter(message => message.t === "invoke")).toHaveLength(0);
    occupied.release();
    const running = Promise.resolve(command.run());
    expect(pluginHostBudget.snapshot().invokes).toBe(baseline.invokes + 1);
    const invocation = worker.sent.find(message => message.t === "invoke")!;
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: worker.callbacks.encode(null) });
    await running;
    expect(pluginHostBudget.snapshot().invokes).toBe(baseline.invokes);
  } finally { occupied.release(); await close(); }
  expect(pluginHostBudget.snapshot()).toEqual(baseline);
});

test("flood admission retires the offender before parsing another graph and drains existing cleanup", async () => {
  let now = 0;
  const rates = { burst: { messages: 8, bytes: 1e8, entries: 1e6 }, perSecond: { messages: 1, bytes: 1, entries: 1 } };
  const meter = new PluginTrafficBudget({ realm: rates, host: rates }, () => now);
  const open = spyOn(pluginTrafficBudget, "open").mockImplementation(() => meter.open());
  const gate = deferred();
  const drain = spyOn(PluginLifecycleController.prototype, "drainStorageWrites").mockImplementation(() => gate.promise);
  const { worker, runtime, close } = await hostFixture();
  try {
    // Boot, hello, ready and promote consume four envelopes; malformed ones count too.
    for (let i = 0; i < 5; i++) await worker.deliver(null);
    expect(worker.terminated).toBe(true);
    let finished = false;
    const stopping = runtime.terminate().then(() => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false);
    const before = worker.sent.length;
    await worker.deliver({ t: "call", id: 983, method: "contributions.commands.register", args: worker.callbacks.encode([]) });
    expect(worker.sent).toHaveLength(before);
    gate.resolve(); await stopping;
    expect(drain).toHaveBeenCalledTimes(1);
    expect(() => meter.open().message()).toThrow();
    now = 1000; expect(() => meter.open().message()).not.toThrow();
  } finally { gate.resolve(); await close(); open.mockRestore(); drain.mockRestore(); }
});

test.each(["read", "cancel", "denied"])("profile inspection Worker RPC %s uses actor grants and request cancellation", async mode => {
  const host = identityHost(), entered = deferred(), gate = deferred();
  if (mode === "cancel") host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
  const spy = spyOn(identityDomain, "inspectProfileContext").mockImplementation(host.service.inspect);
  const { worker, close } = await hostFixture(mode === "denied" ? [] : ["memory:read"]);
  try {
    const pending = worker.deliver({ t: "call", id: 996, method: "domains.memory.queries.profileContext",
      args: worker.callbacks.encode([{ kind: "summary" }, { signal: { forged: true } }]) });
    if (mode === "cancel") { await entered.promise; await worker.deliver({ t: "cancel", id: 996 }); gate.resolve(); }
    await pending;
    const result = worker.sent.find(message => message.t === "result" && message.id === 996);
    expect(result).toMatchObject(mode === "read" ? { ok: true, value: { derivedStatus: "absent", text: null } }
      : { ok: false, code: mode === "denied" ? "plugin/unavailable" : "plugin/cancelled" });
    expect(host.calls).toHaveLength(mode === "denied" ? 0 : 1);
    expect(host.minted).toHaveLength(0);
  } finally { gate.resolve(); await close(); spy.mockRestore(); }
});

test.each(["read", "cancel", "denied"])("context bundle Worker RPC %s resolves the nested memory path with actor grants and cancellation", async mode => {
  const entered = deferred(), gate = deferred(), signals: AbortSignal[] = [];
  const spy = spyOn(contextAccess, "contextBundleAccess").mockImplementation(() => ({
    capture: async () => { throw new AppError("ui/unavailable", "unexpected"); },
    history: async (query, signal) => {
      signals.push(signal!); entered.resolve(); if (mode === "cancel") await gate.promise;
      return { selector: { kind: query.kind, scope: query.scope }, items: [], offset: 0, nextOffset: null, total: 0, revision: `cbhist1:${"a".repeat(64)}` };
    },
    read: async () => null, export: async () => { throw new AppError("ui/unavailable", "unexpected"); },
  }));
  const { worker, close } = await hostFixture(mode === "denied" ? [] : ["memory:read"]);
  try {
    const pending = worker.deliver({ t: "call", id: 997, method: "domains.memory.queries.context.history",
      args: worker.callbacks.encode([{ kind: "user_profile_context", scope: { kind: "user" } }, { signal: { forged: true } }]) });
    if (mode === "cancel") { await entered.promise; await worker.deliver({ t: "cancel", id: 997 }); gate.resolve(); }
    await pending;
    const result = worker.sent.find(message => message.t === "result" && message.id === 997);
    expect(result).toMatchObject(mode === "read" ? { ok: true, value: { total: 0, nextOffset: null } }
      : { ok: false, code: mode === "denied" ? "plugin/unavailable" : "plugin/cancelled" });
    expect(signals).toHaveLength(mode === "denied" ? 0 : 1);
    if (mode === "cancel") expect(signals[0]!.aborted).toBe(true);
  } finally { gate.resolve(); await close(); spy.mockRestore(); }
});

/** Deterministic transport faults, with the real host context and registration path. */
class FaultWorker {
  static current: FaultWorker;
  static bootFault: "failed" | "clone" | "version" | "early-call" | undefined;
  onmessage: ((event: MessageEvent) => Promise<void>) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly sent: WireMessage[] = [];
  readonly callbacks = new PluginCallbackRegistry();
  terminated = false;
  throwOn?: string;
  constructor() { FaultWorker.current = this; }
  postMessage(message: WireMessage) {
    if (message.t === this.throwOn) throw new DOMException("Could not clone message", "DataCloneError");
    this.sent.push(message);
    if (message.t === "boot") {
      if (FaultWorker.bootFault === "clone") throw new DOMException("Could not clone boot", "DataCloneError");
      const response = FaultWorker.bootFault === "failed" ? { t: "failed", error: "activation rejected" } : { t: "ready", protocolVersion: 1, hasMigration: false };
      queueMicrotask(async () => {
        if (FaultWorker.bootFault === "early-call") await this.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: this.callbacks.encode([]) });
        await this.deliver({ t: "hello", protocolVersion: FaultWorker.bootFault === "version" ? 2 : 1 });
        await this.deliver(response);
      });
    }
    if (message.t === "quiesce") queueMicrotask(() => { void this.deliver({ t: "quiesced" }); });
    if (message.t === "release") this.callbacks.release(message.handles!);
  }
  async deliver(message: unknown) { await this.onmessage?.({ data: message } as MessageEvent); }
  terminate() { this.terminated = true; this.callbacks.clear(); }
}

async function hostFixture(permissions: PluginPermission[] = [], promote = true) {
  const native = globalThis.Worker;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
  const disposables: PluginDisposable[] = [];
  globalThis.Worker = FaultWorker as unknown as typeof Worker;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  let started: ReturnType<typeof startPluginWorker>;
  try {
    started = startPluginWorker({ id: "callback-host-test", name: "Callback host test", version: "1.0.0", schemaVersion: 1, permissions, requires: {} }, "1.0.0", disposables, { moduleUrl: "test:callback" });
  } finally {
    globalThis.Worker = native;
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
  const runtime = await started;
  if (promote) runtime.promote();
  const worker = FaultWorker.current;
  return {
    worker,
    runtime,
    async close() {
      try { await runtime.terminate(); }
      finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
    },
  };
}

describe("plugin worker capability bridge", () => {
  test("voice discovery serializes across Worker replies and releases callbacks in stale results", async () => {
    const storage = spyOn(localKV, "entries").mockReturnValue({});
    const { worker, close } = await hostFixture();
    try {
      await worker.deliver({ t: "call", id: 910, method: "contributions.voiceProviders.register", args: worker.callbacks.encode([{
        id: "voice", label: "Voice", listVoices: () => [], synthesize: async () => new Uint8Array(),
      }]) });
      await new Promise(resolve => setTimeout(resolve, 0));
      const invokes = () => worker.sent.filter(message => message.t === "invoke");
      expect(invokes()).toHaveLength(1);
      const baseline = worker.callbacks.size;
      for (let index = 0; index < 20; index++) emitAppEvent("plugin-storage-changed", { pluginId: "callback-host-test" });
      expect(invokes()).toHaveLength(1);
      await worker.deliver({ t: "result", id: invokes()[0].id, ok: true,
        value: worker.callbacks.encode([{ id: "stale", label: "Stale", extra: () => {} }]) });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(invokes()).toHaveLength(2);
      expect(worker.callbacks.size).toBe(baseline);
      const current = () => getDefaultStore().get(voiceProvidersAtom).find(provider => provider.pluginId === "callback-host-test");
      expect(current()?.voices).toEqual([]);
      await worker.deliver({ t: "result", id: invokes()[1].id, ok: true,
        value: worker.callbacks.encode([{ id: "current", label: "Current" }]) });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(current()?.voices[0].id).toBe("current");
      const audio = current()!.synthesize({ text: "A sentence", voiceId: "current" });
      expect(invokes()).toHaveLength(3);
      await worker.deliver({ t: "result", id: invokes()[2].id, ok: true, value: worker.callbacks.encode(new Uint8Array([1, 2, 3])) });
      expect(await audio).toEqual(new Uint8Array([1, 2, 3]));
      await worker.deliver({ t: "dispose", handle: worker.sent.find(message => message.t === "result" && message.id === 910)?.disposable });
      emitAppEvent("plugin-storage-changed", { pluginId: "callback-host-test" });
      expect(current()).toBeUndefined();
      expect(invokes()).toHaveLength(3);
    } finally { await close(); storage.mockRestore(); }
  });
  test("failed candidate promotion restores the previous realm command and its RPC state authority", async () => {
    const old = await hostFixture();
    const candidate = await hostFixture([], false);
    try {
      await old.worker.deliver({ t: "call", id: 901, method: "contributions.commands.register",
        args: old.worker.callbacks.encode([{ id: "rollback", title: "Old", run: () => "old" }]) });
      const handle = old.worker.sent.find(message => message.id === 901)?.disposable;
      const original = getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "rollback")!;
      for (const [id, command] of [[902, { id: "rollback", title: "New", run: () => "new" }],
        [903, { id: "invalid", title: "Invalid", run: () => null, state: {} }]] as const) {
        await candidate.worker.deliver({ t: "call", id, method: "contributions.commands.register", args: candidate.worker.callbacks.encode([command]) });
        expect(candidate.worker.sent.find(message => message.id === id)).toMatchObject({ ok: true });
      }
      expect(() => candidate.runtime.promote()).toThrow();
      expect(getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "rollback")).toBe(original);
      await old.worker.deliver({ t: "call", id: 904, method: "$registration.updateState",
        args: old.worker.callbacks.encode([handle, { revision: 1, enabled: false, visible: true }]) });
      expect(old.worker.sent.find(message => message.id === 904)).toMatchObject({ ok: true, value: { status: "applied" } });
      await candidate.close();
      expect(getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "rollback")?.state?.enabled).toBe(false);
    } finally { await candidate.close(); await old.close(); }
  });
  test.each(["failed", "clone", "version", "early-call"] as const)("startup %s drains the lifecycle before rejecting", async fault => {
    const gate = deferred();
    const drain = spyOn(PluginLifecycleController.prototype, "drainStorageWrites").mockImplementation(() => gate.promise);
    FaultWorker.bootFault = fault;
    try {
      let settled = false;
      const starting = hostFixture().catch(error => { settled = true; return error; });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(FaultWorker.current.terminated).toBe(true);
      expect(settled).toBe(false);
      gate.resolve();
      expect(await starting).toMatchObject({ code: "plugin/unavailable" });
      expect(drain).toHaveBeenCalledTimes(1);
    } finally { gate.resolve(); drain.mockRestore(); FaultWorker.bootFault = undefined; }
  });

  test("host result preflight rejects oversized payloads, bounds failures and recovers", async () => {
    const spy = spyOn(identityDomain, "inspectProfileContext").mockResolvedValue(new Array(1_000_001) as never);
    const { worker, close } = await hostFixture(["memory:read"]);
    try {
      const call = (id: number) => worker.deliver({ t: "call", id, method: "domains.memory.queries.profileContext", args: worker.callbacks.encode([{ kind: "summary" }]) });
      await call(701);
      expect(worker.sent.find(message => message.id === 701)).toMatchObject({ t: "result", ok: false, code: "plugin/quota-exceeded" });
      spy.mockRejectedValue(new AppError("db/locked", "x".repeat(5000)));
      await call(702);
      expect(worker.sent.find(message => message.id === 702)?.error).toHaveLength(4096);
      spy.mockResolvedValue(null as never);
      await call(703);
      expect(worker.sent.find(message => message.id === 703)).toMatchObject({ t: "result", ok: true, value: null });
      expect(worker.terminated).toBe(false);
    } finally { await close(); spy.mockRestore(); }
  });

  test("health send failure retires its pending receipt and runtime immediately", async () => {
    const { worker, runtime, close } = await hostFixture();
    try {
      worker.throwOn = "health";
      await expect(runtime.checkHealth()).rejects.toMatchObject({ code: "plugin/unavailable" });
      expect(worker.terminated).toBe(true);
    } finally { await close(); }
  });

  test.each(["quiesce", "deactivate"])("shutdown %s send failure still drains and terminates the realm", async kind => {
    const { worker, runtime, close } = await hostFixture();
    const drain = spyOn(PluginLifecycleController.prototype, "drainStorageWrites");
    try {
      worker.throwOn = kind;
      await expect(runtime.terminate()).rejects.toThrow();
      expect(drain).toHaveBeenCalledTimes(1);
      expect(worker.terminated).toBe(true);
    } finally { await close().catch(() => { /* The expected shutdown failure is retained on repeat calls. */ }); drain.mockRestore(); }
  });

  test("an old realm crash cannot remove its replacement registrations", async () => {
    const old = await hostFixture();
    await old.worker.deliver({ t: "call", id: 1, method: "contributions.commands.register",
      args: old.worker.callbacks.encode([{ id: "generation", title: "Old", run: () => null }]) });
    const replacement = await hostFixture();
    try {
      await replacement.worker.deliver({ t: "call", id: 1, method: "contributions.commands.register",
        args: replacement.worker.callbacks.encode([{ id: "generation", title: "New", run: () => null }]) });
      old.worker.onerror?.({ message: "old runtime crashed" } as ErrorEvent);
      await old.close();
      expect(replacement.worker.terminated).toBe(false);
      expect(getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "generation")?.title).toBe("New");
    } finally { await old.close(); await replacement.close(); }
  });

  test.each(["error", "messageerror", "failed"])("fatal %s closes contributions, callbacks and pending health immediately", async kind => {
    const { worker, runtime, close } = await hostFixture();
    try {
      await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register",
        args: worker.callbacks.encode([{ id: "crash", title: "Crash", run: () => null }]) });
      const pending = runtime.checkHealth().catch(error => error);
      if (kind === "error") worker.onerror?.({ message: "runtime crashed" } as ErrorEvent);
      else if (kind === "messageerror") worker.onmessageerror?.();
      else await worker.deliver({ t: "failed", error: "runtime failed" });
      expect(worker.terminated).toBe(true);
      expect(await pending).toMatchObject({ code: "plugin/unavailable" });
      expect(worker.callbacks.size).toBe(0);
      expect(getDefaultStore().get(pluginCommandsAtom).some(command => command.id === "crash")).toBe(false);
      await expect(runtime.checkHealth()).rejects.toMatchObject({ code: "plugin/unavailable" });
      expect(() => runtime.promote()).toThrow("Plugin runtime stopped");
      const count = worker.sent.length;
      await worker.deliver({ t: "call", id: 2, method: "contributions.commands.register",
        args: worker.callbacks.encode([{ id: "late", title: "Late", run: () => null }]) });
      expect(worker.sent).toHaveLength(count);
      await close();
      await close();
      expect(worker.sent).toHaveLength(count);
    } finally { await close(); }
  });

  test("fatal failure aborts a running domain read and waits for its cleanup without posting a late result", async () => {
    const entered = deferred(), gate = deferred();
    const host = identityHost();
    host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
    const spy = spyOn(identityDomain, "inspectProfileContext").mockImplementation(host.service.inspect);
    const { worker, close } = await hostFixture(["memory:read"]);
    try {
      const pending = worker.deliver({ t: "call", id: 20, method: "domains.memory.queries.profileContext",
        args: worker.callbacks.encode([{ kind: "summary" }]) });
      await entered.promise;
      worker.onerror?.({ message: "runtime crashed" } as ErrorEvent);
      const count = worker.sent.length;
      let closed = false;
      const closing = close().then(() => { closed = true; });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(closed).toBe(false);
      gate.resolve();
      await pending;
      await closing;
      expect(worker.sent).toHaveLength(count);
    } finally { gate.resolve(); await close(); spy.mockRestore(); }
  });

  test("retained disposable quota rejects before replacement effects and recovers after release", async () => {
    const { worker, close } = await hostFixture();
    try {
      for (let id = 1; id <= PLUGIN_WIRE_LIMITS.disposables + 1; id++) {
        await worker.deliver({ t: "call", id, method: "contributions.commands.register",
          args: worker.callbacks.encode([{ id: "capacity", title: `Command ${id}`, run: () => null }]) });
      }
      expect(worker.sent.find(message => message.t === "result" && message.id === PLUGIN_WIRE_LIMITS.disposables + 1))
        .toMatchObject({ ok: false, code: "plugin/busy" });
      expect(getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "capacity")?.title).toBe(`Command ${PLUGIN_WIRE_LIMITS.disposables}`);
      await worker.deliver({ t: "dispose", handle: "d1" });
      await worker.deliver({ t: "call", id: 5000, method: "contributions.commands.register",
        args: worker.callbacks.encode([{ id: "capacity", title: "Recovered", run: () => null }]) });
      expect(worker.sent.find(message => message.t === "result" && message.id === 5000)).toMatchObject({ ok: true });
      expect(getDefaultStore().get(pluginCommandsAtom).find(command => command.id === "capacity")?.title).toBe("Recovered");
    } finally { await close(); }
  });

  test("direct malformed messages cannot dispatch and the next valid call remains usable", async () => {
    const { worker, close } = await hostFixture();
    try {
      for (const message of [null, [], "invalid", { t: "call", id: 901, method: {}, args: {} },
        { t: "call", id: 902, method: "services.session.environment", args: { data: [], callbacks: [] }, extra: true },
        { t: "cancel", id: NaN }, { t: "dispose", handle: "__proto__" }]) await worker.deliver(message);
      expect(worker.sent.filter(message => message.t === "result")).toEqual([
        { t: "result", id: 901, ok: false, code: "plugin/invalid-input", error: "Plugin message rejected" },
        { t: "result", id: 902, ok: false, code: "plugin/invalid-input", error: "Plugin message rejected" },
      ]);
      await worker.deliver({ t: "call", id: 903, method: "services.session.environment", args: worker.callbacks.encode([]) });
      expect(worker.sent.find(message => message.t === "result" && message.id === 903)).toMatchObject({ ok: true });
    } finally { await close(); }
  });

  test("derives deeply nested domain and contribution methods from the actor view", () => {
    const context = {
      domains: {
        library: {
          queries: { books: { list: () => [] } },
          commands: { books: { importBook: () => null } },
          events: { subscribe: () => ({ dispose() {} }) },
        },
      },
      contributions: {
        contentProviders: { register: () => ({ dispose() {} }) },
      },
      services: {},
    } as unknown as PluginContext;

    expect(describeContext(context)).toMatchObject({
      domains: {
        library: {
          queries: { books: { list: "fn" } },
          commands: { books: { importBook: "fn" } },
          events: { subscribe: "fn" },
        },
      },
      contributions: {
        contentProviders: { register: "fn" },
      },
    });
  });
});

test.each(["query", "navigation"])("%s RPC cancellation reaches the existing domain, not a forged options signal", async kind => {
  let started!: () => void, signal: AbortSignal | undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const run = (value?: AbortSignal): Promise<never> => {
    signal = value; started();
    return new Promise((_, reject) => value!.addEventListener("abort", () => reject(value!.reason), { once: true }));
  };
  const spy = kind === "query" ? spyOn(contentNavigation, "searchBookLocations").mockImplementation((_input, value) => run(value))
    : spyOn(readingRuntime, "step").mockImplementation((_direction, value, guard) => { expect(guard).toEqual({ sessionId: "active" }); return run(value); });
  const { worker, close } = await hostFixture(["library:read", "reading:write"]);
  try {
    const method = kind === "query" ? "domains.library.queries.books.searchLocations" : "domains.reading.commands.step";
    const args = kind === "query" ? [{ bookId: "b", query: "q" }, { signal: { forged: true } }]
      : ["next", { sessionId: "active" }, { signal: { forged: true } }];
    const call = worker.deliver({ t: "call", id: 991, method, args: worker.callbacks.encode(args) });
    await ready;
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal?.aborted).toBe(false);
    await worker.deliver({ t: "cancel", id: 991 }); await call;
    expect(signal?.aborted).toBe(true);
    expect(worker.sent.find(message => message.t === "result" && message.id === 991)).toMatchObject({ ok: false, code: "plugin/cancelled" });
  } finally { await close(); spy.mockRestore(); }
});

test.each(["ask", "askDetailed"])("LLM %s RPC cancellation injects the current request signal into the actual host service", async method => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const run = (input: OneShotInput) => {
    signal = input.signal; started();
    return new Promise((_, reject) => input.signal!.addEventListener("abort", () => reject(input.signal!.reason), { once: true }));
  };
  const runtime = { ask: run, askDetailed: run } as unknown as AgentRuntime;
  const spy = spyOn(runtimeModule, "getAgentRuntime").mockReturnValue(runtime);
  const { worker, close } = await hostFixture(["service:llm"]);
  try {
    const call = worker.deliver({ t: "call", id: 990, method: `services.llm.${method}`, args: worker.callbacks.encode([{ prompt: "p", signal: { fake: true } }]) });
    await ready;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    await worker.deliver({ t: "cancel", id: 990 });
    await call;
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toMatchObject({ code: "ai/request-cancelled" });
    expect(worker.sent.find(message => message.t === "result" && message.id === 990)).toMatchObject({ ok: false, code: "plugin/cancelled" });
  } finally { await close(); spy.mockRestore(); }
});

test("host releases denied and invalid call arguments without granting authority", async () => {
  const { worker, close } = await hostFixture();
  try {
    await worker.deliver({ t: "call", id: 1, method: "domains.library.commands.books.remove", args: worker.callbacks.encode([() => null]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 1)).toMatchObject({ ok: false, code: "plugin/unavailable" });
    expect(worker.callbacks.size).toBe(0);
    await worker.deliver({ t: "call", id: 2, method: "contributions.commands.register", args: worker.callbacks.encode({ run: () => null }) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 2)).toMatchObject({ ok: false, code: "plugin/invalid-input" });
    expect(worker.callbacks.size).toBe(0);
  } finally { await close(); }
});

test("action state RPC owns exact live registrations and rejects unsupported or invalid updates", async () => {
  const { worker, close } = await hostFixture();
  let id = 100;
  const call = async (method: string, args: unknown[]) => {
    const request = id++;
    await worker.deliver({ t: "call", id: request, method, args: worker.callbacks.encode(args) });
    return worker.sent.find(message => message.t === "result" && message.id === request)!;
  };
  try {
    const first = await call("contributions.commands.register", [{ id: "mutable", title: "Mutable", run() {} }]);
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.key === "callback-host-test:mutable")!;
    expect(pluginCallbackOwner(command.run)).toBeDefined();
    expect(await call("$registration.updateState", [first.disposable, { revision: 1, enabled: false, visible: true, checked: true }]))
      .toMatchObject({ ok: true, value: { status: "applied" } });
    expect(command.run).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
    expect(worker.sent.some(message => message.t === "invoke")).toBe(false);
    expect(await call("$registration.updateState", [first.disposable, { revision: 1, enabled: true, visible: true }]))
      .toMatchObject({ ok: true, value: { status: "stale" } });
    expect(await call("$registration.updateState", [first.disposable, undefined]))
      .toMatchObject({ ok: false, code: "plugin/invalid-input" });
    await call("contributions.commands.register", [{ id: "mutable", title: "Replacement", run() {} }]);
    expect(await call("$registration.updateState", [first.disposable, { revision: 100, enabled: false, visible: false }]))
      .toMatchObject({ ok: true, value: { status: "inactive" } });
    await worker.deliver({ t: "dispose", handle: first.disposable });
    expect(await call("$registration.updateState", [first.disposable, {}])).toMatchObject({ ok: true, value: { status: "inactive" } });
    expect(await call("$registration.updateState", ["unknown-or-foreign", {}])).toMatchObject({ ok: true, value: { status: "inactive" } });
    expect(await call("$registration.updateState", [null, {}])).toMatchObject({ ok: false, code: "plugin/invalid-input" });
    const subscription = await call("services.session.observeEnvironment", [() => {}]);
    expect(subscription.ok).toBe(true);
    const notification = worker.sent.findLast(message => message.t === "invoke")!;
    await worker.deliver({ t: "result", id: notification.id, ok: true, value: worker.callbacks.encode(null) });
    expect(await call("$registration.updateState", [subscription.disposable, { revision: 1, enabled: false, visible: false }]))
      .toMatchObject({ ok: false, code: "plugin/unavailable" });
    await worker.deliver({ t: "dispose", handle: subscription.disposable });
  } finally { await close(); }
});

test("context action RPC carries target metadata and owns state updates through disposal", async () => {
  const { worker, close } = await hostFixture();
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.contextActions.register", args: worker.callbacks.encode([
      { id: "book", title: "Book action", surface: "book", run() {} },
    ]) });
    const receipt = worker.sent.find(message => message.t === "result" && message.id === 1)!;
    expect(receipt).toMatchObject({ ok: true });
    expect(receipt.disposable).toBeString();
    const action = getDefaultStore().get(contextActionsAtom).find(item => item.pluginId === "callback-host-test")!;
    const input = { surface: "book" as const, book: { id: "b", title: "Book" } };
    const pending = Promise.resolve(action.run(input)).catch(error => error);
    const invocation = worker.sent.findLast(message => message.t === "invoke")!;
    expect(invocation.args).toEqual([input]);
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: worker.callbacks.encode(null) });
    expect(await pending).toBeNull();
    await worker.deliver({ t: "call", id: 2, method: "$registration.updateState", args: worker.callbacks.encode([
      receipt.disposable, { revision: 1, visible: true, enabled: false },
    ]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 2)).toMatchObject({ ok: true, value: { status: "applied" } });
    expect(() => action.run(input)).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
    await worker.deliver({ t: "dispose", handle: receipt.disposable });
    expect(getDefaultStore().get(contextActionsAtom).some(item => item.pluginId === "callback-host-test")).toBe(false);
    expect(worker.callbacks.size).toBe(0);
  } finally { await close(); }
});

test("ordinary API arguments can transfer callback ownership to a live view without retaining discarded fields", async () => {
  const { worker, close } = await hostFixture();
  let release = () => {};
  let channel: ReturnType<typeof openPluginViewChannel> | undefined;
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: worker.callbacks.encode([{ id: "test", title: "Test", run: () => null }]) });
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "callback-host-test")!;
    const owner = pluginCallbackOwner(command.run)!;
    expect(owner).toBeDefined();
    let action!: () => unknown;
    channel = openPluginViewChannel(owner, update => {
      if (update.view.kind !== "detail") throw Error("Expected detail");
      action = update.view.actions![0].run;
      release = retainPluginCallbacks(action);
    });
    await worker.deliver({ t: "call", id: 2, method: "services.ui.publishView", args: worker.callbacks.encode([channel.channel, {
      revision: 1, view: { kind: "detail", content: [], actions: [{ id: "retained", label: "Retained", run: () => null }], discarded: () => null },
    }]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 2)).toMatchObject({ ok: true, value: { status: "applied" } });
    expect(worker.callbacks.size).toBe(2);
    const invoked = action();
    const request = worker.sent.findLast(message => message.t === "invoke")!;
    await worker.deliver({ t: "result", id: request.id, ok: true, value: worker.callbacks.encode({ toast: "Still callable" }) });
    expect(await invoked).toEqual({ toast: "Still callable" });
    release(); expect(worker.callbacks.size).toBe(1);
    await expect(action()).rejects.toMatchObject({ code: "plugin/unavailable" });
  } finally { release(); channel?.dispose(); await close(); }
});

test("host releases malformed and unmatched callback results and disposed registrations", async () => {
  const { worker, close } = await hostFixture();
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: worker.callbacks.encode([{ id: "test", title: "Test", run: () => null }]) });
    const receipt = worker.sent.find(message => message.t === "result" && message.id === 1)!;
    expect(receipt).toMatchObject({ ok: true, value: null });
    expect(receipt.disposable).toBeString();
    if (typeof receipt.disposable !== "string") throw new Error("Missing registration receipt");
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "callback-host-test")!;
    const pending = Promise.resolve(command.run()).catch(error => error);
    const invocation = worker.sent.find(message => message.t === "invoke")!;
    const malformed = worker.callbacks.encode({ run: () => null });
    malformed.data = {};
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: malformed });
    expect(await pending).toMatchObject({ code: "plugin/invalid-input" });
    expect(worker.callbacks.size).toBe(1);
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: worker.callbacks.encode({ run: () => null }) });
    expect(worker.callbacks.size).toBe(1);
    await worker.deliver({ t: "dispose", handle: receipt.disposable });
    await worker.deliver({ t: "dispose", handle: receipt.disposable });
    expect(worker.callbacks.size).toBe(0);
    expect(getDefaultStore().get(pluginCommandsAtom).some(item => item.pluginId === "callback-host-test")).toBe(false);
  } finally { await close(); }
});

test("shutdown still drains durable writes and terminates its Worker when registration cleanup fails", async () => {
  const { worker, close } = await hostFixture();
  let finishDrain!: () => void;
  let drainStarted = false;
  const drain = spyOn(PluginLifecycleController.prototype, "drainStorageWrites").mockImplementation(() => {
    drainStarted = true;
    return new Promise<void>(resolve => { finishDrain = resolve; });
  });
  let unsubscribe: (() => void) | undefined;
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: worker.callbacks.encode([{ id: "test", title: "Test", run: () => null }]) });
    unsubscribe = getDefaultStore().sub(pluginCommandsAtom, () => { throw new Error("registry observer failed"); });
    const closing = close().catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(drainStarted).toBe(true);
    expect(worker.terminated).toBe(false);
    finishDrain();
    expect(await closing).toBeInstanceOf(AggregateError);
    expect(worker.terminated).toBe(true);
    expect(getDefaultStore().get(pluginCommandsAtom).some(item => item.pluginId === "callback-host-test")).toBe(false);
  } finally {
    unsubscribe?.(); drain.mockRestore();
    if (!worker.terminated) { finishDrain?.(); await close().catch(() => { /* Expected injected shutdown failure. */ }); }
  }
});
