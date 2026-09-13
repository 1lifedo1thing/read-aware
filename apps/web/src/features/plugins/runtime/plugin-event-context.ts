import type { PluginContext, PluginReactionEvent } from "@read-aware/plugin-types";
import type { DomainActor } from "../../../platform/domain-actor";
import { PluginEventReactions } from "./plugin-event-reactions";

/** In-realm equivalent of the Worker envelope. Each call revalidates the lease;
 * immutable per-call actors, resources and activation owners stay in the host. */
export function bindPluginEventContext(event: PluginReactionEvent, reactions: PluginEventReactions,
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
 * bypass the existing event projection. Snapshots are handled by their owners. */
export function attachPluginEventReactions(context: PluginContext, reactions: PluginEventReactions): void {
  for (const [name, domain] of Object.entries(context.domains)) {
    const events = domain?.events as { subscribe?: (...args: any[]) => unknown } | undefined;
    if (!events?.subscribe) continue;
    const subscribe = events.subscribe;
    events.subscribe = (...args: any[]) => {
      const index = name === "settings" ? 0 : 1, handler = args[index], subscription = {};
      args[index] = (event: object) => reactions.deliver(subscription, event,
        reaction => handler({ ...event, reaction }));
      return subscribe(...args);
    };
  }
}
