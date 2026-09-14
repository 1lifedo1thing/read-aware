import { AppError, errorCode, type EventOrigin } from "@read-aware/core";
import { eventCause, reactionActor, type DomainActor } from "../../../platform/domain-actor";

import type { PluginReactionToken } from "@read-aware/plugin-types";
export type { PluginReactionToken } from "@read-aware/plugin-types";
type Entry = { token: PluginReactionToken; actor?: DomainActor };

/** One owner per plugin activation. No mutable ambient actor is used: each
 * accepted operation captures its own immutable actor before it can await. */
export class PluginEventReactions {
  private readonly entries = new Map<string, Entry>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly rules = new WeakMap<object, string>();
  private readonly named = new Map<string, object>();

  constructor(private readonly origin: EventOrigin, private readonly lifetime: AbortSignal) {
    lifetime.addEventListener("abort", () => { this.entries.clear(); this.named.clear(); }, { once: true });
  }

  /** Subscription identity belongs to this activation; it is not chosen by a
   * Worker message, event payload or persisted plugin setting. */
  rule(subscription: object): string {
    let id = this.rules.get(subscription);
    if (!id) { id = crypto.randomUUID(); this.rules.set(subscription, id); }
    return id;
  }
  /** Stable within the plugin, including a later activation. The name selects
   * identity only; delivery still requires an issued event and live lease. */
  bindRule(subscription: object, name: unknown): () => void {
    this.lifetime.throwIfAborted();
    if (name === undefined) return () => {};
    if (typeof name !== "string" || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(name)) throw new AppError("plugin/invalid-argument", "Invalid event rule id");
    if (this.named.has(name)) throw new AppError("plugin/invalid-argument", "Event rule id already registered");
    this.named.set(name, subscription);
    this.rules.set(subscription, `rule:${this.origin}:${name}`);
    return () => { if (this.named.get(name) === subscription) this.named.delete(name); };
  }

  async deliver<T>(subscription: object, event: object, handler: (token: PluginReactionToken) => T | Promise<T>): Promise<T> {
    this.lifetime.throwIfAborted();
    if (this.entries.size >= 64) throw new AppError("plugin/busy", "Too many active event reactions");
    const cause = eventCause(event);
    if (!cause) throw new AppError("plugin/invalid-cause", "Event has no host provenance");
    let actor: DomainActor | undefined;
    try { actor = reactionActor(this.origin, this.rule(subscription), cause); }
    catch (error) { if (errorCode(error) !== "plugin/event-cycle") throw error; }
    const token = Object.freeze({ id: crypto.randomUUID(), status: actor ? "ready" as const : "cycle" as const });
    this.entries.set(token.id, { token, actor });
    try { return await handler(token); }
    finally { this.entries.delete(token.id); }
  }

  /** The dispatcher still checks the original manifest permission, book grant,
   * lifetime and native write preconditions. A token never supplies those. */
  actor(input: PluginReactionToken): DomainActor {
    this.lifetime.throwIfAborted();
    const entry = input && typeof input.id === "string" ? this.entries.get(input.id) : undefined;
    if (!entry || Object.keys(input).some(key => key !== "id" && key !== "status") || input.status !== entry.token.status) {
      throw new AppError("plugin/invalid-cause", "Event reaction expired or belongs to another activation");
    }
    if (!entry.actor) throw new AppError("plugin/event-cycle", "Event reaction would repeat a causal step");
    return entry.actor;
  }

  /** Preserve synchronous registration/collection returns for in-realm callers. */
  invoke<T>(input: PluginReactionToken, run: (actor: DomainActor, signal: AbortSignal) => T): T {
    const actor = this.actor(input);
    if (this.work.size >= 32) throw new AppError("plugin/busy", "Too many active reaction operations");
    const result = run(actor, this.lifetime);
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === "function") {
      const pending = Promise.resolve(result);
      this.work.add(pending);
      void pending.then(() => this.work.delete(pending), () => this.work.delete(pending));
    }
    return result;
  }

  execute<T>(input: PluginReactionToken, run: (actor: DomainActor, signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.invoke(input, run);
  }

  async drain(): Promise<void> { while (this.work.size) await Promise.allSettled([...this.work]); }
}
