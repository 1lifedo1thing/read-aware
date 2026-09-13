import { AppError, errorCode, type EventOrigin } from "@read-aware/core";
import { eventCause, reactionActor, type DomainActor } from "../../../platform/domain-actor";

/** Opaque delivery lease. It grants no operation or object access by itself. */
export type PluginReactionToken = Readonly<{ id: string; status: "ready" | "cycle" }>;
type Entry = { token: PluginReactionToken; actor?: DomainActor };

/** One owner per plugin activation. No mutable ambient actor is used: each
 * accepted operation captures its own immutable actor before it can await. */
export class PluginEventReactions {
  private readonly entries = new Map<string, Entry>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly rules = new WeakMap<object, string>();

  constructor(private readonly origin: EventOrigin, private readonly lifetime: AbortSignal) {
    lifetime.addEventListener("abort", () => this.entries.clear(), { once: true });
  }

  /** Subscription identity belongs to this activation; it is not chosen by a
   * Worker message, event payload or persisted plugin setting. */
  rule(subscription: object): string {
    let id = this.rules.get(subscription);
    if (!id) { id = crypto.randomUUID(); this.rules.set(subscription, id); }
    return id;
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
  execute<T>(input: PluginReactionToken, run: (actor: DomainActor, signal: AbortSignal) => Promise<T>): Promise<T> {
    this.lifetime.throwIfAborted();
    const entry = input && typeof input.id === "string" ? this.entries.get(input.id) : undefined;
    if (!entry || Object.keys(input).some(key => key !== "id" && key !== "status") || input.status !== entry.token.status) {
      throw new AppError("plugin/invalid-cause", "Event reaction expired or belongs to another activation");
    }
    if (!entry.actor) throw new AppError("plugin/event-cycle", "Event reaction would repeat a causal step");
    if (this.work.size >= 32) throw new AppError("plugin/busy", "Too many active reaction operations");
    // Start now, before another delivery can finish or create an independent
    // reaction. Once accepted, work can outlive the delivery but retains its cause.
    let pending: Promise<T>;
    try { pending = Promise.resolve(run(entry.actor, this.lifetime)); }
    catch (error) { pending = Promise.reject(error); }
    this.work.add(pending);
    void pending.then(() => this.work.delete(pending), () => this.work.delete(pending));
    return pending;
  }

  async drain(): Promise<void> { while (this.work.size) await Promise.allSettled([...this.work]); }
}
