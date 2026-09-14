import { commitContributionReplacement, undoContributionReplacement } from "../state/contribution-activation";
import {
  AppError, errorCode, assertOperationAvailable, operationAvailability, type OperationAvailability, type OperationCondition, normalizePluginServiceCall, normalizePluginServiceQuery, normalizePluginServices,
  validatePluginServiceValue, PLUGIN_SERVICE_LIMITS,
  type PluginServiceDeclaration, type PluginServiceCall, type PluginServiceQuery, type PluginServiceReceipt,
  type PluginServicePage, type PluginServiceRef, type SettingsAccessPolicy,
} from "@read-aware/core";
import type { PluginManifest, PluginBookAccess } from "@read-aware/plugin-types";
import type { PluginBookAccessPolicy, PluginBookAccessFence } from "../../../domain/plugin-object-access";
import { createPluginBookAccessPolicy } from "../../../domain/plugin-object-access";
import { assertReactionAllowed, actorCause, causalActor, reactionActor, type DomainActor } from "../../../platform/domain-actor";
import { createLogger } from "../../../platform/logger";

import { i18n } from "../../../i18n/instance";

const log = createLogger("plugin-services");

export type PluginServiceParticipant = {
  manifest: PluginManifest; access: PluginBookAccessPolicy; signal: AbortSignal;
  assertLive(): void; track(work: Promise<void>): void; origin: DomainActor;
  lineage?: readonly string[];
};
export type PluginServiceExecution = {
  manifest: PluginManifest; bookAccess: PluginBookAccess; declaration: PluginServiceDeclaration;
  input: unknown; signal: AbortSignal; callId: string; lineage: readonly string[]; origin: DomainActor;
};
export type PluginServiceExecutor = (execution: PluginServiceExecution) => Promise<unknown>;
type Entry = { provider: PluginServiceParticipant; declaration: PluginServiceDeclaration; ref: PluginServiceRef;
  run: PluginServiceExecutor; lifetime: AbortController; calls: Set<Promise<unknown>> };
const fail = (code: string, message: string) => new AppError(code, message);
const unavailable = () => fail("plugin/service-unavailable", "Plugin service is no longer available");
const denied = () => fail("plugin/service-forbidden", "Plugin service requires shared permissions and object authority");
const key = (pluginId: string, id: string) => `${pluginId}/${id}`;
const grants = (manifest: PluginManifest) => {
  const result = new Set<string>(manifest.permissions ?? []);
  for (const permission of [...result]) if (permission.endsWith(":write")) result.add(permission.replace(/:write$/, ":read"));
  return result;
};
const granted = (participant: PluginServiceParticipant, declaration: PluginServiceDeclaration) => {
  const permissions = grants(participant.manifest);
  return declaration.permissions.every(permission => permissions.has(permission));
};
function intersectPaths(a: readonly string[], b: readonly string[]): string[] {
  const contains = (pattern: string, path: string) => pattern === path || pattern.endsWith(".*") && path.startsWith(pattern.slice(0, -1));
  return [...new Set(a.flatMap(x => b.flatMap(y => contains(x, y) ? [y] : contains(y, x) ? [x] : [])))];
}
export function intersectServiceSettings(a: SettingsAccessPolicy = {}, b: SettingsAccessPolicy = {}): SettingsAccessPolicy {
  const read = (p: SettingsAccessPolicy) => [...p.read ?? [], ...p.write ?? []];
  const discover = (p: SettingsAccessPolicy) => [...p.discover ?? [], ...read(p)];
  return { write: intersectPaths(a.write ?? [], b.write ?? []), read: intersectPaths(read(a), read(b)), discover: intersectPaths(discover(a), discover(b)) };
}
export function serviceExecutionManifest(provider: PluginManifest, caller: PluginManifest, declaration: PluginServiceDeclaration): PluginManifest {
  const a = provider.networkAccess?.origins ?? [], b = caller.networkAccess?.origins ?? [];
  const origins = a.includes("*") ? [...b] : b.includes("*") ? [...a] : a.filter(origin => b.includes(origin));
  // A fresh realm has no activation closure. Its authoritative context contains
  // only the export's declared grants, all of which both participants hold.
  return { id: provider.id, name: provider.name, version: provider.version, schemaVersion: provider.schemaVersion,
    main: provider.main, description: provider.description, requires: {}, permissions: [...declaration.permissions],
    settingsAccess: intersectServiceSettings(provider.settingsAccess, caller.settingsAccess),
    ...(declaration.permissions.includes("service:network") ? { networkAccess: { origins }, requires: { services: { network: "^2.0.0" } } } : {}),
  };
}

/** Registrations belong to activated providers; executions belong to both lifetimes. */
export class PluginServiceBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly callerCounts = new Map<AbortSignal, number>();
  private readonly providerCounts = new Map<AbortSignal, number>();
  private running = 0;
  /** Metadata discovery for the host Agent. Authority is minted only after the
   * user approves a frozen service contract and arguments in delegate(). */
  listForAgent(scope: { kind: "book"; bookId: string } | { kind: "global" }, input?: PluginServiceQuery): PluginServicePage {
    const query = normalizePluginServiceQuery(input);
    const entries = [...this.entries.values()].filter(entry => {
      try { this.current(entry); } catch { return false; }
      if (query.pluginId && entry.ref.pluginId !== query.pluginId || query.id && entry.ref.id !== query.id) return false;
      if (scope.kind === "book") {
        if (entry.declaration.scope !== "book") return false;
        try { entry.provider.access.assertBook(scope.bookId, "Agent service discovery"); } catch { return false; }
      }
      return true;
    }).sort((a, b) => key(a.ref.pluginId, a.ref.id).localeCompare(key(b.ref.pluginId, b.ref.id)));
    const services = entries.slice(query.offset, query.offset + query.limit).map(entry => structuredClone({ ...entry.declaration, ref: entry.ref }));
    return { services, total: entries.length, nextOffset: query.offset + services.length < entries.length ? query.offset + services.length : null };
  }

  async delegate(scope: { kind: "book"; bookId: string } | { kind: "global" }, raw: PluginServiceCall,
    authorize: (subject: string, signal: AbortSignal) => Promise<boolean>, callSignal?: AbortSignal): Promise<
      { executed: false; reason: "declined" } | { executed: true; receipt: PluginServiceReceipt }> {
    callSignal?.throwIfAborted();
    const request = normalizePluginServiceCall(raw);
    const entry = this.entries.get(key(request.service.pluginId, request.service.id));
    if (!entry || entry.ref.generation !== request.service.generation || entry.ref.version !== request.service.version) throw unavailable();
    this.current(entry);
    if (scope.kind === "book" && (entry.declaration.scope !== "book" || request.bookId !== scope.bookId)) throw denied();
    if (entry.declaration.scope === "book" ? !request.bookId : request.bookId !== undefined || entry.provider.access.grant.mode !== "all") throw denied();
    assertOperationAvailable(this.inspectForAgent(request));
    request.input = validatePluginServiceValue(entry.declaration.input, request.input);
    const approvedPermissions = [...entry.declaration.permissions];
    const approvedSettings = structuredClone(entry.provider.manifest.settingsAccess ?? {});
    const approvedNetwork = structuredClone(entry.provider.manifest.networkAccess);
    const preview = JSON.stringify({ service: request.service, title: entry.declaration.title, description: entry.declaration.description,
      scope: entry.declaration.scope, bookId: request.bookId, permissions: approvedPermissions,
      settingsAccess: approvedSettings, networkOrigins: approvedNetwork?.origins ?? [], input: request.input }, null, 2);
    if (preview.length > 16_384) throw fail("plugin/invalid-argument", "Service approval exceeds display budget");
    const fence = request.bookId ? await entry.provider.access.beginBook(request.bookId, "Agent service approval") : undefined;
    const lifetime = new AbortController();
    const timer = setTimeout(() => lifetime.abort(fail("plugin/service-timeout", "Service approval expired")), 300_000);
    const signal = AbortSignal.any([lifetime.signal, entry.provider.signal, entry.lifetime.signal, ...(callSignal ? [callSignal] : []), ...(fence?.signal ? [fence.signal] : [])]);
    const pending = new Set<Promise<void>>();
    try {
      signal.throwIfAborted();
      const subject = `${entry.provider.manifest.name} / ${entry.declaration.title}\n${preview}\n\n${i18n.t("pluginServices.approvalNote", { ns: "common", defaultValue: "Approve these permissions for this call only. Book access includes the full book and may include unread material; global access includes all books. Changes and external effects may not be undoable." })}`;
      if (!await authorize(subject, signal)) return { executed: false, reason: "declined" };
      signal.throwIfAborted(); this.current(entry); await fence?.assertUnchanged({ retain: true });
      // Unlike a synthetic all-permissions Agent, this caller possesses only
      // the specific service authority just approved by the user.
      const caller: PluginServiceParticipant = { manifest: {
        id: "agent-service", name: "Agent service", version: "1.0.0", schemaVersion: 1, requires: {},
        permissions: approvedPermissions, settingsAccess: approvedSettings,
        ...(approvedNetwork ? { networkAccess: approvedNetwork } : {}),
      }, access: createPluginBookAccessPolicy(request.bookId ? { mode: "book", bookId: request.bookId } : { mode: "all" }, async () => ({ bookId: null, sessionId: null })),
        signal, assertLive: () => signal.throwIfAborted(), origin: "agent",
        track: work => { pending.add(work); void work.finally(() => pending.delete(work)); },
      };
      return { executed: true, receipt: await this.call(caller, request, signal) };
    } finally {
      clearTimeout(timer); lifetime.abort(); fence?.dispose();
      await Promise.allSettled([...pending]);
    }
  }
  register(provider: PluginServiceParticipant, run: PluginServiceExecutor): { dispose(): void } {
    provider.assertLive(); provider.signal.throwIfAborted();
    const declarations = normalizePluginServices(provider.manifest.services);
    if (this.entries.size + declarations.length > 1024) throw fail("plugin/busy", "Service catalog is full");
    if (declarations.some(declaration => !granted(provider, declaration))) throw denied();
    const registered: Entry[] = [];
    for (const declaration of declarations) {
      const id = key(provider.manifest.id, declaration.id);
      const previous = this.entries.get(id);
      const entry: Entry = { provider, declaration, run, lifetime: new AbortController(), calls: new Set(),
        ref: { pluginId: provider.manifest.id, id: declaration.id, version: declaration.version, generation: crypto.randomUUID() } };
      undoContributionReplacement(() => {
        entry.lifetime.abort(unavailable());
        if (this.entries.has(id) && this.entries.get(id) !== entry) return;
        if (previous && !previous.lifetime.signal.aborted) this.entries.set(id, previous); else this.entries.delete(id);
      });
      this.entries.set(id, entry); registered.push(entry);
      if (previous) commitContributionReplacement(() => previous.lifetime.abort(unavailable()));
    }
    let stopped = false;
    const dispose = () => {
      if (stopped) return; stopped = true; provider.signal.removeEventListener("abort", dispose);
      for (const entry of registered) {
        if (this.entries.get(key(entry.ref.pluginId, entry.ref.id)) === entry) this.entries.delete(key(entry.ref.pluginId, entry.ref.id));
        entry.lifetime.abort(unavailable());
      }
    };
    provider.signal.addEventListener("abort", dispose, { once: true });
    return { dispose };
  }
  private current(entry: Entry): void {
    entry.provider.assertLive(); entry.provider.signal.throwIfAborted();
    if (entry.lifetime.signal.aborted || this.entries.get(key(entry.ref.pluginId, entry.ref.id)) !== entry) throw unavailable();
  }
  list(caller: PluginServiceParticipant, input?: PluginServiceQuery): PluginServicePage {
    caller.assertLive(); caller.signal.throwIfAborted(); const query = normalizePluginServiceQuery(input);
    const visible = [...this.entries.values()].filter(entry => {
      try { this.current(entry); } catch { return false; }
      if (!granted(caller, entry.declaration)) return false;
      if (entry.declaration.scope === "global" && (caller.access.grant.mode !== "all" || entry.provider.access.grant.mode !== "all")) return false;
      const a = caller.access.grant, b = entry.provider.access.grant;
      if (a.mode === "book" && b.mode === "book" && a.bookId !== b.bookId) return false;
      return (!query.pluginId || entry.ref.pluginId === query.pluginId) && (!query.id || entry.ref.id === query.id);
    }).sort((a, b) => key(a.ref.pluginId, a.ref.id).localeCompare(key(b.ref.pluginId, b.ref.id)));
    const services = visible.slice(query.offset, query.offset + query.limit).map(entry => structuredClone({ ...entry.declaration, ref: entry.ref }));
    return { services, total: visible.length, nextOffset: query.offset + services.length < visible.length ? query.offset + services.length : null };
  }
  private prepare(caller: PluginServiceParticipant, raw: PluginServiceCall) {
    caller.assertLive(); caller.signal.throwIfAborted();
    const request = normalizePluginServiceCall(raw), entry = this.entries.get(key(request.service.pluginId, request.service.id));
    if (!entry || entry.ref.version !== request.service.version || entry.ref.generation !== request.service.generation) throw unavailable();
    this.current(entry);
    if (!granted(caller, entry.declaration) || !granted(entry.provider, entry.declaration)) throw denied();
    if (entry.declaration.scope === "book" ? !request.bookId : request.bookId !== undefined
      || caller.access.grant.mode !== "all" || entry.provider.access.grant.mode !== "all") throw denied();
    if (request.bookId) for (const participant of [caller, entry.provider]) participant.access.assertBook(request.bookId, "plugin service");
    const nextKey = key(entry.ref.pluginId, entry.ref.id), lineage = [...caller.lineage ?? []];
    if (lineage.length >= 8 || lineage.includes(nextKey)) throw fail("plugin/service-cycle", "Plugin service call would repeat its invocation chain");
    assertReactionAllowed(actorCause(caller.origin), `service:${nextKey}`);
    const input = validatePluginServiceValue(entry.declaration.input, request.input);
    return { request, entry, input, nextKey, lineage };
  }
  private capacity(entry: Entry, caller?: PluginServiceParticipant): OperationCondition {
    const busy = this.running >= 16 || (this.providerCounts.get(entry.provider.signal) ?? 0) >= 4
      || !!caller && (this.callerCounts.get(caller.signal) ?? 0) >= 4;
    return { kind: "capacity", state: busy ? "unavailable" : "satisfied", reason: busy ? "service-capacity-exceeded" : "service-capacity-available",
      ...(busy ? { errorCode: "plugin/busy" } : {}) };
  }
  private inspectionFailure(request: PluginServiceCall, error: unknown): OperationAvailability {
    const code = errorCode(error) ?? "internal";
    const permission = code === "plugin/service-forbidden" || code === "plugin/object-access-denied";
    const known = permission || ["plugin/service-unavailable", "plugin/service-cycle", "plugin/event-cycle", "plugin/invalid-argument"].includes(code);
    if (!known) log.warn("Cannot inspect plugin service prerequisites", error);
    return operationAvailability({ operation: "plugins.callService", serviceCall: request }, [{
      kind: permission ? "permission" : code === "plugin/invalid-argument" ? "input" : "provider",
      state: known ? "unavailable" : "unknown", reason: permission ? "service-authority-required" : "service-prerequisite-failed", errorCode: code,
    }]);
  }
  inspect(caller: PluginServiceParticipant, raw: PluginServiceCall): OperationAvailability {
    caller.assertLive(); caller.signal.throwIfAborted();
    const request = normalizePluginServiceCall(raw);
    try {
      const { entry } = this.prepare(caller, request);
      return operationAvailability({ operation: "plugins.callService", serviceCall: request }, [
        { kind: "permission", state: "satisfied", reason: "shared-service-authority" },
        { kind: "input", state: "satisfied", reason: "service-contract-valid" }, this.capacity(entry, caller),
        { kind: "provider", state: "unknown", reason: "service-execution-not-probed" },
      ]);
    } catch (error) { caller.signal.throwIfAborted(); return this.inspectionFailure(request, error); }
  }
  inspectForAgent(raw: PluginServiceCall): OperationAvailability {
    const request = normalizePluginServiceCall(raw);
    try {
      const entry = this.entries.get(key(request.service.pluginId, request.service.id));
      if (!entry || entry.ref.generation !== request.service.generation || entry.ref.version !== request.service.version) throw unavailable();
      this.current(entry);
      if (!granted(entry.provider, entry.declaration)) throw denied();
      if (entry.declaration.scope === "book" ? !request.bookId : request.bookId !== undefined || entry.provider.access.grant.mode !== "all") throw denied();
      if (request.bookId) entry.provider.access.assertBook(request.bookId, "Agent service inspection");
      validatePluginServiceValue(entry.declaration.input, request.input);
      return operationAvailability({ operation: "plugins.callService", serviceCall: request }, [
        { kind: "permission", state: "unknown", reason: "service-approval-required" },
        { kind: "input", state: "satisfied", reason: "service-contract-valid" }, this.capacity(entry),
        { kind: "provider", state: "unknown", reason: "service-execution-not-probed" },
      ]);
    } catch (error) { return this.inspectionFailure(request, error); }
  }
  async call(caller: PluginServiceParticipant, raw: PluginServiceCall, callSignal?: AbortSignal): Promise<PluginServiceReceipt> {
    caller.assertLive(); caller.signal.throwIfAborted(); callSignal?.throwIfAborted();
    const { request, entry, input, nextKey, lineage } = this.prepare(caller, raw);
    const fences: PluginBookAccessFence[] = [];
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(fail("plugin/service-timeout", "Plugin service deadline elapsed")), PLUGIN_SERVICE_LIMITS.timeoutMs);
    const callId = crypto.randomUUID();
    let accounted = false;
    try {
      if (request.bookId) for (const participant of [caller, entry.provider]) fences.push(await participant.access.beginBook(request.bookId, "plugin service"));
      const signal = AbortSignal.any([caller.signal, entry.provider.signal, entry.lifetime.signal, deadline.signal,
        ...callSignal ? [callSignal] : [], ...fences.flatMap(fence => fence.signal ? [fence.signal] : [])]);
      signal.throwIfAborted(); caller.assertLive(); this.current(entry);
      if (this.capacity(entry, caller).state === "unavailable") throw fail("plugin/busy", "Plugin service execution capacity exceeded");
      this.running++; this.providerCounts.set(entry.provider.signal, (this.providerCounts.get(entry.provider.signal) ?? 0) + 1); this.callerCounts.set(caller.signal, (this.callerCounts.get(caller.signal) ?? 0) + 1); accounted = true;
      const origin = reactionActor(`plugin:${entry.ref.pluginId}`, `service:${nextKey}`, actorCause(causalActor(caller.origin))!);
      const execution = Promise.resolve().then(() => {
        signal.throwIfAborted(); this.current(entry);
        return entry.run({ manifest: serviceExecutionManifest(entry.provider.manifest, caller.manifest, entry.declaration),
          bookAccess: request.bookId ? { mode: "book", bookId: request.bookId } : { mode: "all" }, declaration: entry.declaration,
          input, signal, callId, lineage: [...lineage, nextKey], origin });
      });
      entry.calls.add(execution);
      const settlement = execution.then(() => {}, () => {}).finally(() => { entry.calls.delete(execution); });
      caller.track(settlement); entry.provider.track(settlement);
      let result: unknown;
      try { result = await execution; }
      catch (error) {
        signal.throwIfAborted(); log.warn("Service execution failed", nextKey, error);
        throw fail(errorCode(error) ?? "plugin/service-failed", "Plugin service execution failed");
      }
      signal.throwIfAborted(); caller.assertLive(); this.current(entry);
      for (const fence of fences) await fence.assertUnchanged({ retain: true });
      signal.throwIfAborted();
      return { callId, service: { ...entry.ref }, value: validatePluginServiceValue(entry.declaration.output, result, "plugin/service-result-invalid") };
    } finally {
      clearTimeout(timer); for (const fence of fences) fence.dispose();
      if (accounted) { this.running--;
        const providerCount = (this.providerCounts.get(entry.provider.signal) ?? 1) - 1;
        if (providerCount) this.providerCounts.set(entry.provider.signal, providerCount); else this.providerCounts.delete(entry.provider.signal);
        const count = (this.callerCounts.get(caller.signal) ?? 1) - 1;
        if (count) this.callerCounts.set(caller.signal, count); else this.callerCounts.delete(caller.signal); }
    }
  }
}
export const pluginServices = new PluginServiceBroker();
