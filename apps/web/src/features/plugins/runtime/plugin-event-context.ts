import type { PluginContext, PluginDisposable, PluginReactionEvent } from "@read-aware/plugin-types";
import type { DomainActor } from "../../../platform/domain-actor";
import { PluginEventReactions } from "./plugin-event-reactions";

/** In-realm equivalent of the Worker envelope. Each call revalidates the lease;
 * immutable per-call actors, resources and activation owners stay in the host. */
export function bindPluginEventContext(event: PluginReactionEvent | undefined, reactions: PluginEventReactions,
  contextForActor: (actor: DomainActor) => PluginContext): PluginContext {
  const token = event?.reaction!;
  const context = contextForActor(reactions.actor(token));
  const wrap = (namespace: object, path: string): object => Object.fromEntries(Object.entries(namespace).map(([key, value]) => {
    const method = `${path}.${key}`;
    if (typeof value === "function") return [key, (...args: unknown[]) => reactions.invoke(token, () => {
      const result = value(...args);
      return method === "services.storage.collection" ? wrap(result, method) : result;
    })];
    return [key, value && typeof value === "object" ? wrap(value, method) : value];
  }));
  return { ...context, get locale() { return context.locale; },
    domains: wrap(context.domains, "domains") as PluginContext["domains"],
    contributions: wrap(context.contributions, "contributions") as PluginContext["contributions"],
    services: wrap(context.services, "services") as PluginContext["services"] };
}

/** Applied after authorization/scope filtering, so no token-bearing event can
 * bypass the existing event projection. Observation metadata is separate from
 * the snapshot, preserving its shape and host-private provenance. */
export function attachPluginEventReactions(context: PluginContext, reactions: PluginEventReactions): void {
  for (const [name, domain] of Object.entries(context.domains)) {
    const events = domain?.events as { subscribe?: (...args: any[]) => unknown } | undefined;
    if (!events?.subscribe) continue;
    const subscribe = events.subscribe;
    events.subscribe = (...args: any[]) => {
      const index = name === "settings" ? 0 : 1, handler = args[index], subscription = {};
      const release = reactions.bindRule(subscription, args[index + 1]?.ruleId);
      args[index] = (event: object) => reactions.deliver(subscription, event,
        reaction => handler({ ...event, reaction }));
      try {
        const registration = subscribe(...args) as PluginDisposable;
        return { dispose: () => { try { registration.dispose(); } finally { release(); } } };
      } catch (error) { release(); throw error; }
    };
  }
  const observations: [object | undefined, string, number][] = [
    [context.domains.settings?.queries, "observe", 1],
    [context.domains.annotations?.events, "observe", 1],
    [context.domains.memory?.events, "observe", 1],
    [context.domains.reading?.events, "observeSession", 0],
    [context.domains.library?.events, "observeInvalidation", 0],
    [context.domains.conversations?.events, "observeInvalidation", 0],
    [context.services.storage, "observeDocuments", 1],
    [context.services.ui.reader, "observe", 0],
    [context.services.ui.reader?.image, "observe", 0],
    [context.services.plugins, "observeContributions", 1],
  ];
  for (const [namespace, key, index] of observations) {
    const methods = namespace as Record<string, (...args: any[]) => unknown> | undefined;
    const observe = methods?.[key];
    if (!observe) continue;
    methods![key] = (...args: any[]) => {
      const handler = args[index], subscription = {};
      args[index] = (snapshot: object | null, source?: object) => reactions.deliver(subscription, source ?? snapshot!,
        reaction => handler(snapshot, { reaction }));
      if (key !== "observeSession") return observe(...args);
      const release = reactions.bindRule(subscription, args[index + 1]?.ruleId);
      try {
        const registration = observe(...args) as PluginDisposable;
        return { dispose: () => { try { registration.dispose(); } finally { release(); } } };
      } catch (error) { release(); throw error; }
    };
  }
}
