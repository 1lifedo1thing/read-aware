import { AppError, type EventOrigin } from "@read-aware/core";
import type { PluginActionRegistration, PluginActionState, PluginDisposable, PluginEventRegistration, PluginReactionEvent } from "@read-aware/plugin-types";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";
import type { PluginEventReactions } from "./plugin-event-reactions";
import type { PluginLifecycleController } from "./plugin-lifecycle";

type HostRegistration = {
  dispose(source?: DomainActor): void;
  updateState?(state: PluginActionState, source?: DomainActor): ReturnType<PluginActionRegistration["updateState"]>;
};
type Operations = { dispose(source: DomainActor): void; updateState?: NonNullable<HostRegistration["updateState"]> };

/** Exact activation-owned handles. Sources are captured per operation; neither
 * registration data nor a mutable ambient actor carries host authority. */
export class PluginContributionReactions {
  private readonly handles = new WeakMap<object, Operations>();
  constructor(private lifecycle: PluginLifecycleController, private reactions: PluginEventReactions, private origin: EventOrigin) {}

  stage(factory: (source: DomainActor) => HostRegistration, source: DomainActor): PluginDisposable {
    return this.register(factory, source, false);
  }
  action(factory: (source: DomainActor) => Required<HostRegistration>, source: DomainActor): PluginActionRegistration {
    return this.register(factory, source, true) as PluginActionRegistration;
  }

  private register(factory: (source: DomainActor) => HostRegistration, source: DomainActor, action: boolean): PluginDisposable {
    const registrationSource = causalActor(source);
    let live: HostRegistration | undefined, retirement: DomainActor | undefined;
    const staged = this.lifecycle.stage(() => {
      live = factory(registrationSource);
      return { dispose: () => live?.dispose(retirement ?? this.lifecycle.retirementActor ?? registrationSource) };
    });
    const operations: Operations = {
      dispose: source => { retirement ??= this.lifecycle.retirementActor ?? causalActor(source); staged.dispose(); },
      ...(action ? { updateState: (state: PluginActionState, source?: DomainActor) => {
        this.lifecycle.assertActive("contribution.updateState");
        return live?.updateState ? live.updateState(state, causalActor(source ?? this.origin)) : Promise.resolve({ status: "inactive" as const });
      } } : {}),
    };
    const handle = { dispose: () => operations.dispose(causalActor(this.origin)),
      ...(operations.updateState ? { updateState: (state: PluginActionState) => operations.updateState!(state, causalActor(this.origin)) } : {}) };
    this.handles.set(handle, operations);
    return handle;
  }

  /** Host-only startup/migration dispatch; never accepts a Worker-supplied actor. */
  withSource<T extends PluginDisposable>(registration: T, source: DomainActor): PluginEventRegistration<T> {
    const operations = registration && this.handles.get(registration);
    if (!operations) throw new AppError("plugin/invalid-cause", "Contribution registration belongs to another activation");
    const actor = causalActor(source);
    return { dispose: async () => operations.dispose(actor),
      ...(operations.updateState ? { updateState: (state: PluginActionState) => operations.updateState!(state, actor) } : {}),
    } as PluginEventRegistration<T>;
  }

  bind<T extends PluginDisposable>(event: PluginReactionEvent | undefined, registration: T): PluginEventRegistration<T> {
    const token = event?.reaction!;
    this.reactions.actor(token);
    const operations = registration && this.handles.get(registration);
    if (!operations) throw new AppError("plugin/invalid-cause", "Contribution registration belongs to another activation or is not a contribution");
    const bound = {
      dispose: async () => this.reactions.invoke(token, source => operations.dispose(source)),
      ...(operations.updateState ? { updateState: (state: PluginActionState) =>
        this.reactions.invoke(token, source => operations.updateState!(state, source)) } : {}),
    };
    this.handles.set(bound, operations);
    return bound as PluginEventRegistration<T>;
  }
}
