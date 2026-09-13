import { AppError, type EventOrigin } from "@read-aware/core";

/** Host-owned causal identity. It is separate from the persisted actor name. */
export type EventCause = Readonly<{ root: string; steps: readonly string[] }>;
export type DomainActor = EventOrigin | Readonly<{ origin: EventOrigin; cause: EventCause }>;

const issued = new WeakSet<object>();
const actors = new WeakSet<object>();
const causes = new WeakMap<object, EventCause>();
const MAX_REACTION_DEPTH = 32;

function issue(root: string, steps: readonly string[]): EventCause {
  const cause = Object.freeze({ root, steps: Object.freeze([...steps]) });
  issued.add(cause);
  return cause;
}

export function actorOrigin(actor: DomainActor): EventOrigin {
  if (typeof actor === "string") return actor;
  actorCause(actor);
  return actor.origin;
}

export function actorCause(actor?: DomainActor): EventCause | undefined {
  if (actor === undefined || typeof actor === "string") return undefined;
  if (!actors.has(actor) || !issued.has(actor.cause)) throw new AppError("plugin/invalid-cause", "Event cause was not issued by this host");
  return actor.cause;
}

/** Called at the effect boundary, before the event is offered to consumers. */
export function stampEventCause<T extends object>(event: T, actor?: DomainActor): T {
  causes.set(event, actorCause(actor) ?? issue(crypto.randomUUID(), []));
  return event;
}

export function eventCause(event: object): EventCause | undefined { return causes.get(event); }

/** Scope filters copy payloads before delivery; retain provenance outside data. */
export function copyEventCause<T extends object>(source: object, target: T): T {
  const cause = causes.get(source);
  if (cause) causes.set(target, cause);
  return target;
}

/** Each subscription can react once in a causal path. A distinct rule in the
 * same plugin is a legitimate next step, and independent user events start new paths. */
export function reactionActor(origin: EventOrigin, rule: string, cause: EventCause): DomainActor {
  if (!issued.has(cause)) throw new AppError("plugin/invalid-cause", "Event cause was not issued by this host");
  if (cause.steps.includes(rule) || cause.steps.length >= MAX_REACTION_DEPTH) {
    throw new AppError("plugin/event-cycle", "Event reaction would repeat a causal step");
  }
  const actor = Object.freeze({ origin, cause: issue(cause.root, [...cause.steps, rule]) });
  actors.add(actor);
  return actor;
}
