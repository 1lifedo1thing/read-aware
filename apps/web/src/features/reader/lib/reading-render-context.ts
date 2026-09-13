import { causalActor, type DomainActor } from "../../../platform/domain-actor";

// Foliate carries opaque identities, never host actors or serialized causes.
// Public reading calls always create this context in the host after authorization.
const actors = new WeakMap<object, DomainActor>();

export function readingRenderContext(origin: DomainActor): object {
  const actor = causalActor(origin), context = Object.freeze({});
  actors.set(context, actor);
  return context;
}

/** Native navigation also has an identity, shared by its load/relocate feedback.
 * It starts an independent root; the identity itself supplies no permissions. */
export function readingRenderActor(source: object, fallback: DomainActor = "user"): DomainActor {
  const context = "context" in source && typeof source.context === "object" && source.context !== null ? source.context : source;
  let actor = actors.get(context);
  if (!actor) { actor = causalActor(fallback); actors.set(context, actor); }
  return actor;
}
