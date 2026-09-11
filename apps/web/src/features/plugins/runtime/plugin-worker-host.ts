/**
 * Host side of the plugin sandbox.
 *
 * Owns one Worker per plugin and is the only thing standing between it and the
 * app. The plugin's code runs where `__TAURI_INTERNALS__` does not exist (see
 * plugin-sandbox.worker.ts), so everything it wants has to arrive here as a
 * message — and everything here goes through `buildPluginContext`, which is the
 * same permission-gated surface plugins used to hold directly. The difference
 * is that it is now the ONLY surface: a plugin can no longer step around the
 * object it was handed.
 *
 * Contributions register in reverse: the Worker sends a serializable
 * description with handles standing in for its functions, and this module
 * re-registers it with those handles wrapped as async calls back into the
 * Worker.
 */
import type {
  PluginContext,
  PluginDisposable,
  PluginMigration,
  PluginManifest,
} from "@read-aware/plugin-types";
import { AppError, errorCode } from "@read-aware/core";
import { injectPluginCallSignal, pluginCallDrainsCancellation } from "./plugin-call-options";
import { buildPluginContext, currentAppLocale, pluginStoragePrefix } from "./plugin-context";
import { pluginModuleUrl } from "./plugin-backend";
import { i18n } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { localKV, onLocalKVChange } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { invalidateSyncTransportSessions } from "../../../platform/sync/transport-registry";
import { updateInstalledPlugin } from "../state/plugin-store";
import { flattenPluginRequest, flattenPluginResponse } from "./plugin-network-wire";
import { PluginRpcPending } from "./plugin-rpc-pending";
import { decodePluginCallbacks, retainPluginCallbacks, type PluginCallbackWire } from "./plugin-callback-wire";
import type { PluginActionRegistration } from "../lib/plugin-types";
import { parsePluginWorkerMessage, PLUGIN_PROTOCOL_VERSION, rejectedPluginCallbackHandles, validPluginCallId, type WorkerMessage } from "./plugin-worker-protocol";
import { parsePluginHostMessage, type ContextShape, type HostMessage } from "./plugin-host-protocol";
export type { ContextShape } from "./plugin-host-protocol";
import { PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";
import { PluginCallbackBudget } from "./plugin-callback-budget";
import { pluginHostBudget, pluginTrafficBudget, type BudgetLease } from "./plugin-host-budget";

type HeldRegistration = PluginDisposable & Partial<Pick<PluginActionRegistration, "updateState">>;
const actionRegistrations = new Set(["selectionActions", "headerActions", "contextActions", "commands", "agentTools"].map(point => `contributions.${point}.register`));

const log = createLogger("plugins");

export type SandboxedPlugin = {
  manifest: PluginManifest;
  readonly hasMigration: boolean;
  checkHealth(): Promise<void>;
  migrate(migration: PluginMigration): Promise<void>;
  promote(): void;
  terminate(): Promise<void>;
};

export type StartPluginWorkerOptions = {
  /** Alternate entry URL for a separately staged update candidate. */
  moduleUrl?: string;
  /** Distinguishes two simultaneous versions of one plugin. */
  instanceId?: string;
  /** Candidate failures must not overwrite the installed version's status. */
  onRuntimeError?: (message: string) => void;
};

// ─── Host → worker state sync ────────────────────────────────────────────────
//
// The worker keeps local mirrors so `storage.get()` and `ctx.locale` stay
// synchronous. Worker-side writes already flow back here; this is the other
// direction: when the HOST changes (a settings edit from the Plugins panel,
// the app language switching), every live sandbox gets a `sync` patch, or
// its mirror silently serves boot-time values forever.

const liveWorkers = new Map<string, { pluginId: string; worker: Worker; sync: (patch: Extract<HostMessage, { t: "sync" }>["patch"]) => void }>();
let syncWired = false;

function wireHostSync(): void {
  if (syncWired) return;
  syncWired = true;
  onLocalKVChange((key) => {
    const changed = new Set<string>();
    for (const { pluginId, sync } of liveWorkers.values()) {
      const prefix = pluginStoragePrefix(pluginId);
      if (key.startsWith(prefix)) sync({ storage: localKV.entries(prefix) });
      if (key === `${prefix}settings`) changed.add(pluginId);
    }
    for (const pluginId of changed) invalidateSyncTransportSessions(pluginId);
  });
  onAppEvent("plugin-storage-changed", ({ pluginId }) => {
    for (const live of liveWorkers.values()) {
      if (live.pluginId !== pluginId) continue;
      live.sync({ storage: localKV.entries(pluginStoragePrefix(pluginId)) });
    }
    invalidateSyncTransportSessions(pluginId);
  });
  i18n.on("languageChanged", () => {
    const locale = currentAppLocale();
    for (const { sync } of liveWorkers.values()) {
      sync({ locale });
    }
  });
}

/**
 * Walk a dotted method path to the callable on the real context.
 *
 * A namespace the manifest did not earn simply isn't on the context, so an
 * unauthorized call lands here as a missing property and is refused — the same
 * outcome as before, now enforced across a realm boundary the plugin cannot
 * reach past. `storage.collection(name).op` carries its collection inline.
 */
function resolveMethod(
  ctx: PluginContext,
  method: string,
): ((...args: unknown[]) => unknown) | null {
  // Own enumerable properties of plain objects only — the context is built
  // entirely from literals, so anything reachable via the prototype chain
  // (`constructor` and friends) is by definition not part of the granted
  // surface and must not resolve.
  const step = (target: unknown, key: string): unknown =>
    target !== null &&
    typeof target === "object" &&
    Object.prototype.hasOwnProperty.call(target, key)
      ? (target as Record<string, unknown>)[key]
      : undefined;
  const collection = method.match(
    /^services\.storage\.collection\(([^)]*)\)\.(\w+)$/,
  );
  if (collection) {
    const api = ctx.services.storage.collection(
      collection[1],
    ) as unknown as Record<string, unknown>;
    const fn = step(api, collection[2]);
    return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).bind(api) : null;
  }
  const parts = method.split(".");
  let target: unknown = ctx;
  for (let i = 0; i < parts.length - 1; i += 1) {
    target = step(target, parts[i]);
    if (!target) return null;
  }
  const fn = step(target, parts[parts.length - 1]);
  return typeof fn === "function"
    ? (fn as (...a: unknown[]) => unknown).bind(target)
    : null;
}

/**
 * The context's SHAPE, as a tree of "fn" leaves and nested namespaces.
 *
 * The Worker builds its proxy from this rather than from a hand-written copy of
 * the API. Hand-copying is how a sandbox silently drifts from the real surface
 * — miss that `books.write` is a nested namespace and a plugin gets a context
 * that fails its own capability check. Deriving it means the sandbox exposes
 * exactly what `buildPluginContext` decided to grant, no more and no less.
 */
/** Data (not callables) the Worker mirrors locally to keep sync reads sync. */
const SHAPE_SKIP = new Set(["manifest", "appVersion", "locale", "lifecycle", "capabilities"]);

function describeShape(value: unknown, depth = 0): ContextShape {
  const shape: ContextShape = {};
  if (!value || typeof value !== "object" || depth > 8) return shape;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "function") shape[key] = "fn";
    else if (entry && typeof entry === "object") shape[key] = describeShape(entry, depth + 1);
  }
  return shape;
}

export function describeContext(ctx: PluginContext): ContextShape {
  const shape: ContextShape = {};
  for (const [key, value] of Object.entries(ctx as unknown as Record<string, unknown>)) {
    if (SHAPE_SKIP.has(key)) continue;
    if (typeof value === "function") shape[key] = "fn";
    else if (value && typeof value === "object") shape[key] = describeShape(value, 1);
  }
  // `storage.collection()` is a factory, so its methods are described from a
  // throwaway instance rather than discovered on the context itself.
  try {
    shape.__collection = describeShape(
      ctx.services.storage.collection("probe"),
      1,
    );
  } catch {
    shape.__collection = {};
  }
  return shape;
}

export function startPluginWorker(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
  options: StartPluginWorkerOptions = {},
): Promise<SandboxedPlugin> {
  const runtime = buildPluginContext(manifest, appVersion, disposables);
  const ctx = runtime.context;
  const worker = new Worker(new URL("./plugin-sandbox.worker.ts", import.meta.url), {
    type: "module",
    name: `plugin:${manifest.id}`,
  });
  const instanceId = options.instanceId ?? manifest.id;
  wireHostSync();
  let terminated = false;
  let quiescing = false;
  let termination: Promise<void> | undefined;
  let invalidMessageReported = false;
  let acknowledgeQuiescence: ((error?: string) => void) | undefined;
  const traffic = pluginTrafficBudget.open();
  let retireForTraffic: (error: unknown) => void;
  const accountTraffic = (usage?: { bytes: number; entries: number }) => {
    try { if (usage) traffic.graph(usage); else traffic.message(); }
    catch (error) { retireForTraffic(error); throw error; }
  };
  const post = (input: HostMessage) => {
    if (terminated) return;
    accountTraffic();
    const message = "error" in input ? { ...input, error: input.error.slice(0, 4096) } : input;
    worker.postMessage(parsePluginHostMessage(message, accountTraffic));
  };

  const pendingInvokes = new PluginRpcPending();
  const callbackBudget = new PluginCallbackBudget(count => pluginHostBudget.reserve("callbacks", count));
  const incomingCalls = new Map<number, AbortController>();
  const abortIncomingCalls = () => {
    for (const controller of incomingCalls.values()) controller.abort(new AppError("plugin/cancelled", "Plugin runtime stopped"));
  };
  let nextHealthId = 1;
  const pendingHealth = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  let nextMigrationId = 1;
  const pendingMigrations = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  const failAllHealthChecks = (reason: string) => {
    for (const pending of pendingHealth.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new AppError("plugin/unavailable", reason));
    }
    pendingHealth.clear();
  };
  const failAllMigrations = (reason: string) => {
    for (const pending of pendingMigrations.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new AppError("plugin/unavailable", reason));
    }
    pendingMigrations.clear();
  };
  /** Call a function the plugin kept inside the Worker. */
  const invokeHandle = async (handle: string, args: unknown[]): Promise<unknown> => {
    const lease = pluginHostBudget.reserve("invokes");
    try { return await pendingInvokes.call(id => { post({ t: "invoke", id, handle, args }); }); }
    finally { lease.release(); }
  };

  const releaseCallbacks = (wire: PluginCallbackWire) => {
    const handles = Array.isArray(wire?.callbacks)
      ? wire.callbacks.flatMap(entry => typeof entry?.handle === "string" ? [entry.handle] : []) : [];
    if (!terminated && handles.length) post({ t: "release", handles });
  };

  /**
   * Disposables the plugin is holding. A `PluginDisposable` cannot be cloned, so
   * the Worker gets a handle and releases it by sending that back.
   */
  const heldDisposables = new Map<string, HeldRegistration>();
  let nextDisposableId = 1;

  const assertRunning = () => {
    if (terminated || quiescing) throw new AppError("plugin/unavailable", "Plugin runtime stopped");
  };
  const closeTransport = (reason: string) => {
    if (terminated) return;
    terminated = true;
    quiescing = true;
    runtime.lifecycle.cancelOperations();
    abortIncomingCalls();
    pendingInvokes.close(new AppError("plugin/unavailable", reason));
    failAllHealthChecks(reason);
    failAllMigrations(reason);
    acknowledgeQuiescence?.(reason);
    const live = liveWorkers.get(instanceId);
    if (live?.worker === worker) liveWorkers.delete(instanceId);
    worker.terminate();
    callbackBudget.close();
  };
  const drainRuntime = async () => {
    const errors: unknown[] = [];
    try { runtime.lifecycle.stop(); } catch (error) { errors.push(error); }
    for (const disposable of heldDisposables.values()) {
      try { disposable.dispose(); } catch (error) { errors.push(error); }
    }
    heldDisposables.clear();
    try { await runtime.lifecycle.drainCleanups(); } catch (error) { errors.push(error); }
    try { await runtime.lifecycle.drainStorageWrites(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Plugin shutdown failed");
  };

  return new Promise<SandboxedPlugin>((resolve, reject) => {
    let settled = false;
    let handshaken = false;
    const failRuntime = (reason: string) => {
      const starting = !settled;
      const currentInstance = liveWorkers.get(instanceId)?.worker === worker;
      settled = true;
      clearTimeout(activationTimeout);
      closeTransport(reason);
      termination ??= drainRuntime();
      // A fatal transport failure has no caller to await shutdown. Keep the
      // same promise for terminate(), but always observe background failures.
      void termination.catch(error => log.error(`Cleanup after failure in "${manifest.id}" failed`, error));
      if (starting) void termination.then(
        () => reject(new AppError("plugin/unavailable", reason)),
        error => reject(new AggregateError([new AppError("plugin/unavailable", reason), error], "Plugin activation and cleanup failed")),
      );
      else {
        log.error(`runtime error in "${manifest.id}"`, reason);
        if (options.onRuntimeError) options.onRuntimeError(reason);
        else if (currentInstance) updateInstalledPlugin(manifest.id, { error: reason });
      }
    };
    const activationTimeout = setTimeout(() => {
      if (settled) return;
      failRuntime("plugin activation timed out");
    }, 10_000);
    retireForTraffic = error => failRuntime(error instanceof Error ? error.message : "Plugin transport traffic exhausted");
    liveWorkers.set(instanceId, { pluginId: manifest.id, worker, sync(patch) {
      try { post({ t: "sync", patch }); }
      catch (error) { failRuntime(error instanceof Error ? error.message : String(error)); }
    } });

    worker.onerror = (event) => {
      if (!terminated) failRuntime(event.message || "plugin worker failed");
    };
    worker.onmessageerror = () => { if (!terminated) failRuntime("plugin message could not be deserialized"); };

    worker.onmessage = async (event: MessageEvent<unknown>) => {
      if (terminated) return;
      let message: WorkerMessage;
      try { accountTraffic(); message = parsePluginWorkerMessage(event.data, accountTraffic); }
      catch (error) {
        if (terminated) return;
        // Correlate only the envelope, never invoke methods or inspect arbitrary
        // callback graphs after failed admission. Rate-limit diagnostics per realm.
        if (!invalidMessageReported) { invalidMessageReported = true; log.warn(`Invalid Worker message from "${manifest.id}"`, error); }
        const handles = rejectedPluginCallbackHandles(event.data);
        if (handles.length) post({ t: "release", handles });
        const raw = event.data as { t?: unknown; id?: unknown } | null;
        if (!handshaken || raw?.t === "hello" || raw?.t === "ready") {
          failRuntime("Plugin transport handshake rejected");
          return;
        }
        if (raw && validPluginCallId(raw.id)) {
          if (raw.t === "call") post({ t: "result", id: raw.id, ok: false, code: errorCode(error), error: "Plugin message rejected" });
          else if (raw.t === "result") pendingInvokes.settle(raw.id, false, error);
        }
        return;
      }
      if (message.t === "hello") {
        if (handshaken) failRuntime("Duplicate plugin transport handshake");
        else handshaken = true;
        return;
      }
      if (!handshaken && message.t !== "failed") {
        failRuntime("Plugin called host before transport handshake");
        return;
      }
      switch (message.t) {
        case "ready":
          if (!settled) {
            settled = true;
            clearTimeout(activationTimeout);
            resolve({
              manifest,
              hasMigration: message.hasMigration,
              checkHealth() {
                try { assertRunning(); } catch (error) { return Promise.reject(error); }
                const id = nextHealthId++;
                return new Promise<void>((healthResolve, healthReject) => {
                  const timeout = setTimeout(() => {
                    pendingHealth.delete(id);
                    healthReject(new Error("plugin health check timed out"));
                  }, 2_000);
                  pendingHealth.set(id, {
                    resolve: healthResolve,
                    reject: healthReject,
                    timeout,
                  });
                  try { post({ t: "health", id }); }
                  catch (error) { failRuntime(error instanceof Error ? error.message : String(error)); }
                });
              },
              migrate(migration) {
                try { assertRunning(); } catch (error) { return Promise.reject(error); }
                const id = nextMigrationId++;
                try { parsePluginHostMessage({ t: "migrate", id, migration }); }
                catch (error) { return Promise.reject(error); }
                runtime.lifecycle.beginMigration();
                try { post({ t: "sync", patch: { phase: "migrating", storage: localKV.entries(pluginStoragePrefix(manifest.id)) } }); }
                catch (error) { failRuntime(error instanceof Error ? error.message : String(error)); return Promise.reject(error); }
                return new Promise<void>((migrationResolve, migrationReject) => {
                  const timeout = setTimeout(() => {
                    pendingMigrations.delete(id);
                    runtime.lifecycle.finishMigration();
                    try { post({ t: "sync", patch: { phase: "activating" } }); }
                    catch (error) { failRuntime(error instanceof Error ? error.message : String(error)); }
                    migrationReject(new Error("plugin data migration timed out"));
                  }, 30_000);
                  pendingMigrations.set(id, {
                    resolve: migrationResolve,
                    reject: migrationReject,
                    timeout,
                  });
                  try { post({ t: "migrate", id, migration }); }
                  catch (error) { failRuntime(error instanceof Error ? error.message : String(error)); }
                });
              },
              promote() {
                assertRunning();
                post({ t: "sync", patch: { phase: "active" } });
                try {
                  runtime.lifecycle.promote();
                } catch (error) {
                  post({ t: "sync", patch: { phase: "activating" } });
                  throw error;
                }
              },
              terminate() {
                return termination ??= (async () => {
                  quiescing = true;
                  runtime.lifecycle.cancelOperations();
                  abortIncomingCalls();
                  // This message barrier lets already-issued Worker writes reach
                  // the host before it closes the gate and drains native writes.
                  const quiescenceError = await new Promise<string | undefined>(done => {
                    const timeout = setTimeout(() => done("plugin quiescence timed out"), 2_000);
                    acknowledgeQuiescence = error => { clearTimeout(timeout); done(error); };
                    try { post({ t: "quiesce" }); }
                    catch (error) { acknowledgeQuiescence?.(error instanceof Error ? error.message : String(error)); }
                  });
                  acknowledgeQuiescence = undefined;
                  // Retire migration timers/results before closing the lifecycle:
                  // a late response must not reopen (or throw from) a stopped realm.
                  failAllMigrations(`plugin "${manifest.id}" was deactivated`);
                  try {
                    await drainRuntime();
                    if (quiescenceError) throw new AppError("plugin/unavailable", quiescenceError);
                  } finally {
                    try {
                      post({ t: "deactivate" });
                      await new Promise(done => setTimeout(done, 50));
                    } finally { closeTransport(`plugin "${manifest.id}" was deactivated`); }
                  }
                })();
              },
            });
          }
          return;

        case "failed":
          failRuntime(message.error);
          return;

        case "dispose": {
          const disposable = heldDisposables.get(message.handle);
          heldDisposables.delete(message.handle);
          try {
            disposable?.dispose();
          } catch (error) {
            log.error(`dispose from "${manifest.id}" failed`, error);
          }
          return;
        }

        case "quiesced":
          acknowledgeQuiescence?.(message.error);
          return;

        case "cancel":
          incomingCalls.get(message.id)?.abort(new AppError("plugin/cancelled", "Plugin call cancelled"));
          return;

        case "call": {
          if (incomingCalls.has(message.id)) return;
          if (incomingCalls.size >= 256) {
            releaseCallbacks(message.args);
            post({ t: "result", id: message.id, ok: false, code: "plugin/busy", error: "Too many pending plugin calls" });
            return;
          }
          const controller = new AbortController();
          let argumentOwner: HeldRegistration | undefined;
          let callLease: BudgetLease | undefined;
          let registrationLease: BudgetLease | undefined;
          let releaseArguments = () => releaseCallbacks(message.args);
          incomingCalls.set(message.id, controller);
          const timeout = setTimeout(() => controller.abort(new AppError("plugin/timeout", "Plugin call timed out")), 120_000);
          controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
          try {
            callLease = pluginHostBudget.reserve("calls");
            registrationLease = pluginHostBudget.reserve("registrations");
            // Reserve for every in-flight call before invoking anything: a rejected
            // replacement registration must not displace the currently live one.
            if (heldDisposables.size + incomingCalls.size > PLUGIN_WIRE_LIMITS.disposables) {
              throw new AppError("plugin/busy", "Plugin disposable capacity exceeded");
            }
            if (quiescing && !message.method.startsWith("services.storage.")) {
              throw new AppError("plugin/cancelled", "Plugin runtime is stopping");
            }
            const method = message.method === "$registration.updateState"
              ? (...params: unknown[]) => {
                runtime.lifecycle.assertActive("contribution.updateState");
                const [handle, state] = params;
                if (typeof handle !== "string") throw new AppError("plugin/invalid-input", "Registration handle must be a string");
                const registration = heldDisposables.get(handle);
                if (!registration) return { status: "inactive" };
                if (!registration.updateState) throw new AppError("plugin/unavailable", "Registration has no action state");
                return registration.updateState(state as Parameters<PluginActionRegistration["updateState"]>[0]);
              }
              : resolveMethod(ctx, message.method);
            if (!method) throw new AppError("plugin/unavailable", `"${message.method}" is not granted to plugin "${manifest.id}"`);
            const callbackLease = callbackBudget.acquire(message.args);
            releaseArguments = () => { callbackLease.dispose(); releaseCallbacks(message.args); };
            const args = decodePluginCallbacks(message.args, invokeHandle, handles => {
              callbackLease.release(handles);
              if (!terminated) post({ t: "release", handles });
            }, runtime.lifecycle.signal);
            // Ordinary consumers may retain a normalized subgraph (live view updates).
            // Registrations transfer this entire lease to their returned disposable.
            releaseArguments = retainPluginCallbacks(args);
            if (!Array.isArray(args)) throw new AppError("plugin/invalid-input", "Plugin call arguments must be an array");
            injectPluginCallSignal(message.method, args, controller.signal);
            if (message.method === "services.network.fetch" || message.method === "services.network.openStream") {
              // Validate the body limit on the authoritative side too: a plugin
              // can send messages directly rather than use its friendly proxy.
              const request = await flattenPluginRequest(args[0] as RequestInfo | URL, { ...(args[1] as RequestInit | undefined), signal: controller.signal });
              args[0] = request.url;
              args[1] = { ...request.init, signal: controller.signal };
            }
            if (message.method === "services.llm.ask" || message.method === "services.llm.askDetailed") {
              args[0] = { ...(args[0] as object), signal: controller.signal };
            }
            let value = await method(...args);
            if (value instanceof Response) value = await flattenPluginResponse(value, controller.signal);
            // A registration answers with a disposable, which cannot be cloned:
            // hold it and send back the handle the Worker releases it by.
            if (
              value &&
              typeof value === "object" &&
              typeof (value as PluginDisposable).dispose === "function"
            ) {
              if (heldDisposables.size >= PLUGIN_WIRE_LIMITS.disposables) {
                (value as PluginDisposable).dispose();
                throw new AppError("plugin/busy", "Plugin disposable capacity exceeded");
              }
              if (terminated || controller.signal.aborted) {
                (value as PluginDisposable).dispose();
                throw controller.signal.reason ?? new AppError("plugin/unavailable", "Plugin runtime stopped");
              }
              const handle = `d${nextDisposableId++}`;
              const registration = value as PluginDisposable;
              const retainedLease = registrationLease;
              registrationLease = undefined;
              let disposed = false;
              argumentOwner = {
                dispose() {
                  if (disposed) return;
                  disposed = true;
                  try { registration.dispose(); }
                  finally { try { releaseArguments(); } finally { retainedLease.release(); } }
                },
              };
              if (actionRegistrations.has(message.method) && typeof (registration as HeldRegistration).updateState === "function") {
                argumentOwner.updateState = state => disposed ? Promise.resolve({ status: "inactive" })
                  : (registration as PluginActionRegistration).updateState(state);
              }
              heldDisposables.set(handle, argumentOwner);
              try {
                post({ t: "result", id: message.id, ok: true, value: null, disposable: handle });
              } catch (error) {
                heldDisposables.delete(handle);
                argumentOwner.dispose();
                throw error;
              }
              return;
            }
            post({ t: "result", id: message.id, ok: true, value: value ?? null });
          } catch (error) {
            const failure = controller.signal.aborted && !pluginCallDrainsCancellation(message.method) ? controller.signal.reason : error;
            if (message.method.startsWith("services.network.") && !controller.signal.aborted) {
              log.warn("Plugin network request failed", manifest.id, message.method, failure);
            }
            post({
              t: "result",
              id: message.id,
              ok: false,
              error: failure instanceof Error ? failure.message : String(failure),
              // Stable codes (AppError) survive the boundary as data — the
              // worker rebuilds an Error carrying `code`, so a plugin rethrow
              // keeps it and the host can render code-specific copy.
              code: errorCode(failure),
            });
          } finally {
            // Streaming callbacks belong to the call; registration callbacks
            // belong to the returned disposable, not the plugin's entire lifetime.
            try { if (!argumentOwner) releaseArguments(); }
            finally {
              registrationLease?.release(); callLease?.release();
              clearTimeout(timeout);
              incomingCalls.delete(message.id);
            }
          }
          return;
        }

        case "result": {
          if (message.ok) {
            let callbackLease: ReturnType<PluginCallbackBudget["acquire"]> | undefined;
            try {
              if (!pendingInvokes.has(message.id)) {
                releaseCallbacks(message.value);
                return;
              }
              callbackLease = callbackBudget.acquire(message.value);
              const acceptedLease = callbackLease;
              const value = decodePluginCallbacks(message.value, invokeHandle, handles => {
                acceptedLease.release(handles);
                if (!terminated) post({ t: "release", handles });
              }, runtime.lifecycle.signal);
              pendingInvokes.settle(message.id, true, value);
            } catch (error) {
              callbackLease?.dispose();
              releaseCallbacks(message.value);
              pendingInvokes.settle(message.id, false, error);
            }
          } else
            pendingInvokes.settle(message.id, false,
              message.code
                ? new AppError(message.code, message.error)
                : new Error(message.error),
            );
          return;
        }

        case "healthy": {
          const pending = pendingHealth.get(message.id);
          if (!pending) return;
          pendingHealth.delete(message.id);
          clearTimeout(pending.timeout);
          pending.resolve();
          return;
        }

        case "migrated": {
          const pending = pendingMigrations.get(message.id);
          if (!pending) return;
          pendingMigrations.delete(message.id);
          clearTimeout(pending.timeout);
          runtime.lifecycle.finishMigration();
          try { post({ t: "sync", patch: { phase: "activating" } }); }
          catch (error) {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
            failRuntime(error instanceof Error ? error.message : String(error));
            return;
          }
          if (message.ok) pending.resolve();
          else pending.reject(new Error(message.error));
          return;
        }
      }
    };

    try { post({
      t: "boot",
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      url: options.moduleUrl ?? pluginModuleUrl(manifest.id, manifest.main ?? "main.js"),
      manifest,
      appVersion,
      capabilities: ctx.capabilities,
      shape: describeContext(ctx),
      storage: localKV.entries(pluginStoragePrefix(manifest.id)),
      locale: ctx.locale,
      phase: runtime.lifecycle.phase,
    }); } catch (error) { failRuntime(error instanceof Error ? error.message : String(error)); }
  });
}
