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

/** Host-private durable envelope. Only restore data read from host-owned job
 * records; never accept this through a plugin API or an event payload. */
export type DurableActorSource = { version: 1; root: string; paths: Array<{ root: string; steps: string[] }> };
export function saveActorSource(actor: DomainActor): DurableActorSource {
  const cause = actorCause(causalActor(actor))!;
  return { version: 1, root: cause.root, paths: branches.get(cause)!.map(path => ({ root: path.root, steps: [...path.steps] })) };
}
export function restoreActorSource(origin: EventOrigin, input: unknown): DomainActor {
  const invalid = () => new AppError("plugin/invalid-cause", "Invalid durable event source");
  const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const data = input as DurableActorSource;
  if (Object.keys(data).some(key => !["version", "root", "paths"].includes(key)) || data.version !== 1 || !text(data.root, 128)
    || !Array.isArray(data.paths) || !data.paths.length || data.paths.length > MAX_REACTION_DEPTH) throw invalid();
  const paths = data.paths.map(path => {
    if (!path || typeof path !== "object" || Array.isArray(path) || Object.keys(path).some(key => key !== "root" && key !== "steps")
      || !text(path.root, 128) || !Array.isArray(path.steps) || path.steps.length > MAX_REACTION_DEPTH || path.steps.some(step => !text(step, 512))) throw invalid();
    return Object.freeze({ root: path.root, steps: Object.freeze([...path.steps]) });
  });
  if (new Set(paths.map(path => path.root)).size !== paths.length) throw invalid();
  const cause = issue(data.root, [...new Set(paths.flatMap(path => [...path.steps]))].slice(0, MAX_REACTION_DEPTH));
  branches.set(cause, paths);
  const actor = Object.freeze({ origin, cause }); actors.add(actor); return actor;
}

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

/** Capture one explicit host operation once, including a new user/system root.
 * Later lifecycle feedback must reuse this actor rather than minting new roots. */
export function causalActor(origin: DomainActor): DomainActor {
  if (typeof origin !== "string") {
    if (!origin || !actorCause(origin)) throw new AppError("plugin/invalid-cause", "Operation has no host provenance");
    return origin;
  }
  const actor = Object.freeze({ origin, cause: issue(crypto.randomUUID(), []) });
  actors.add(actor);
  return actor;
}

/** Host-only continuation from an already stamped observation or render state. */
export function actorFromEvent(source: object, origin: EventOrigin = "system"): DomainActor {
  const cause = eventCause(source);
  if (!cause) throw new AppError("plugin/invalid-cause", "Event has no host provenance");
  const actor = Object.freeze({ origin, cause });
  actors.add(actor);
  return actor;
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

/** Inspect eligibility without issuing or consuming a reaction actor. */
export function assertReactionAllowed(cause: EventCause | undefined, rule: string): void {
  if (cause) eligibleReactionBranches(cause, rule);
}
function eligibleReactionBranches(cause: EventCause, rule: string): readonly CausalBranch[] {
  if (!issued.has(cause)) throw new AppError("plugin/invalid-cause", "Event cause was not issued by this host");
  const eligible = branches.get(cause)!.filter(path => !path.steps.includes(rule) && path.steps.length < MAX_REACTION_DEPTH);
  if (!eligible.length) {
    throw new AppError("plugin/event-cycle", "Event reaction would repeat a causal step");
  }
  return eligible;
}
/** Each subscription can react once in a causal path. A distinct rule in the
 * same plugin is a legitimate next step, and independent user events start new paths. */
export function reactionActor(origin: EventOrigin, rule: string, cause: EventCause): DomainActor {
  const eligible = eligibleReactionBranches(cause, rule);
  // A new independent trigger can run even when coalesced with an exhausted
  // path. Only its eligible roots propagate; the repeated roots stay retired.
  const actor = Object.freeze({ origin, cause: joined(eligible.map(path => ({ root: path.root, steps: [...path.steps, rule] }))) });
  actors.add(actor);
  return actor;
}
