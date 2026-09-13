import { AppError, type EventOrigin } from "@read-aware/core";

/** Host-owned causal identity. It is separate from the persisted actor name. */
export type EventCause = Readonly<{ root: string; steps: readonly string[] }>;
export type DomainActor = EventOrigin | Readonly<{ origin: EventOrigin; cause: EventCause }>;

const issued = new WeakSet<object>();
const actors = new WeakSet<object>();
const causes = new WeakMap<object, EventCause>();
type CausalBranch = Readonly<{ root: string; steps: readonly string[] }>;
const branches = new WeakMap<EventCause, readonly CausalBranch[]>();
const MAX_REACTION_DEPTH = 32;

function issue(root: string, steps: readonly string[]): EventCause {
  const cause = Object.freeze({ root, steps: Object.freeze([...steps]) });
  issued.add(cause);
  branches.set(cause, [cause]);
  return cause;
}

function joined(paths: readonly CausalBranch[]): EventCause {
  if (paths.length === 1) return issue(paths[0]!.root, paths[0]!.steps);
  const result = issue(crypto.randomUUID(), [...new Set(paths.flatMap(path => [...path.steps]))].slice(0, MAX_REACTION_DEPTH));
  branches.set(result, paths.map(path => Object.freeze({ root: path.root, steps: Object.freeze([...path.steps]) })));
  return result;
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

/** Coalescing is a join, not a new independent action. Keep all ancestor rules,
 * bounded at the rejection depth; a saturated join must never erase ancestry. */
export function mergeEventCauses<T extends object>(sources: readonly object[], target: T): T {
  const inputs = sources.map(source => {
    const cause = eventCause(source);
    if (!cause) throw new AppError("plugin/invalid-cause", "Cannot merge an untracked event");
    return cause;
  });
  if (!inputs.length) return stampEventCause(target);
  if (inputs.every(cause => cause === inputs[0])) return copyEventCause(sources[0]!, target);
  const roots = new Map<string, Set<string>>();
  for (const cause of inputs) for (const path of branches.get(cause)!) {
    const steps = roots.get(path.root) ?? new Set<string>();
    for (const step of path.steps) if (steps.size < MAX_REACTION_DEPTH) steps.add(step);
    roots.set(path.root, steps);
  }
  // Bound independent roots as well as depth. A saturated join must not become
  // a fresh action just because an old root was dropped from the budget.
  if (roots.size > MAX_REACTION_DEPTH) causes.set(target, issue(crypto.randomUUID(), Array.from({ length: MAX_REACTION_DEPTH }, (_, i) => `overflow:${i}`)));
  else causes.set(target, joined([...roots].map(([root, steps]) => ({ root, steps: [...steps] }))));
  return target;
}

/** A query observer retains only one bounded causal join between settled reads.
 * Mutations during a read require another sample before anything is delivered. */
export class ObservationCauses {
  revision = 0;
  private pending: object | undefined;
  constructor(actor?: DomainActor) { if (actorCause(actor)) this.pending = stampEventCause({}, actor); }
  add(source: object): void {
    this.pending = mergeEventCauses(this.pending ? [this.pending, source] : [source], {});
    this.revision++;
  }
  take<T extends object>(target: T, retry?: object): T {
    const source = this.pending && retry ? mergeEventCauses([this.pending, retry], {}) : this.pending ?? retry ?? stampEventCause({});
    this.pending = undefined;
    return copyEventCause(source, target);
  }
}

/** Each subscription can react once in a causal path. A distinct rule in the
 * same plugin is a legitimate next step, and independent user events start new paths. */
export function reactionActor(origin: EventOrigin, rule: string, cause: EventCause): DomainActor {
  if (!issued.has(cause)) throw new AppError("plugin/invalid-cause", "Event cause was not issued by this host");
  const eligible = branches.get(cause)!.filter(path => !path.steps.includes(rule) && path.steps.length < MAX_REACTION_DEPTH);
  if (!eligible.length) {
    throw new AppError("plugin/event-cycle", "Event reaction would repeat a causal step");
  }
  // A new independent trigger can run even when coalesced with an exhausted
  // path. Only its eligible roots propagate; the repeated roots stay retired.
  const actor = Object.freeze({ origin, cause: joined(eligible.map(path => ({ root: path.root, steps: [...path.steps, rule] }))) });
  actors.add(actor);
  return actor;
}
