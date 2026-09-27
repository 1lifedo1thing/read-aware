import type { PluginDisposable } from "@read-aware/plugin-types";
import { pluginObjectAccessDenied } from "../../../domain/plugin-object-access";
import type { PluginLifecycleController } from "./plugin-lifecycle";

/**
 * Restricted (current-book / specified-book) domain surfaces are policy tables.
 *
 * Each table is typed from the public domain API, so every member — including
 * optional ones — must be classified; adding a domain method without deciding
 * its restricted behaviour fails to compile. Members are built only through
 * the classifications below, which apply the lifecycle rule themselves, so a
 * method body can no longer forget it:
 *
 * - `deny`: outside a book grant; always rejects with plugin/object-access-denied.
 * - `read`: never runs after the realm stops. Object-scoped branches still
 *   fence the grant (scopedRead/scopedCurrentRead also require the active phase);
 *   unscoped branches follow the unrestricted read rules, which permit reads
 *   while the plugin is activating.
 * - `command`: every state-changing call requires the active phase before any
 *   grant check or domain dispatch, exactly like the unrestricted commands.
 * - `observe`: the returned factory is staged on the lifecycle, so observers are
 *   inert until promotion, unavailable during migration and retired with the realm.
 * - `absent`: an optional member the unrestricted surface does not expose either.
 */
const policyKind: unique symbol = Symbol("plugin-restricted-policy");

export type RestrictedPolicyKind = "deny" | "read" | "command" | "observe";

type Method = (...args: any[]) => any;

type DenyPolicy = { readonly [policyKind]: "deny" };
type AbsentPolicy = { readonly [policyKind]: "absent" };
type RunPolicy<F extends Method> = { readonly [policyKind]: "read" | "command"; readonly run: F };
type ObservePolicy<F extends Method> = {
  readonly [policyKind]: "observe";
  readonly run: (...args: Parameters<F>) => () => PluginDisposable;
};
type MethodPolicy<F extends Method> = DenyPolicy | RunPolicy<F>
  | (ReturnType<F> extends PluginDisposable ? ObservePolicy<F> : never);

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];

/** The exhaustive restricted classification of a domain API shape. */
export type RestrictedPolicy<T> = T extends Method ? MethodPolicy<T> : {
  readonly [K in keyof T]-?: K extends OptionalKeys<T>
    ? RestrictedPolicy<Exclude<T[K], undefined>> | AbsentPolicy
    : RestrictedPolicy<T[K]>;
};

export const restricted = {
  deny: { [policyKind]: "deny" } as DenyPolicy,
  absent: { [policyKind]: "absent" } as AbsentPolicy,
  read: <F extends Method>(run: F): RunPolicy<F> => ({ [policyKind]: "read", run }),
  command: <F extends Method>(run: F): RunPolicy<F> => ({ [policyKind]: "command", run }),
  observe: <A extends unknown[]>(run: (...args: A) => () => PluginDisposable) =>
    ({ [policyKind]: "observe" as const, run }),
};

type AnyPolicy = DenyPolicy | AbsentPolicy | RunPolicy<Method> | { readonly [policyKind]: "observe"; readonly run: Method };

/** Classification of every method a restricted surface object exposes, keyed by
 * the owning object so wrappers installed later (event reactions) keep it. */
const classifications = new WeakMap<object, ReadonlyMap<string, RestrictedPolicyKind>>();

export function restrictedPolicyOf(surface: object, key: string): RestrictedPolicyKind | undefined {
  return classifications.get(surface)?.get(key);
}

type RestrictedLifecycle = Pick<PluginLifecycleController, "assertActive" | "stage" | "signal">;

function isPolicy(value: object): value is AnyPolicy {
  return policyKind in value;
}

/** Build a restricted surface from its policy table. `path` names the surface
 * in lifecycle and denial errors, e.g. `domains.library`. */
export function restrictSurface<T>(lifecycle: RestrictedLifecycle, path: string, table: RestrictedPolicy<T>): T {
  return build(lifecycle, path, table as object) as T;
}

function build(lifecycle: RestrictedLifecycle, path: string, table: object): object {
  const surface: Record<string, unknown> = {};
  const kinds = new Map<string, RestrictedPolicyKind>();
  for (const [key, entry] of Object.entries(table) as [string, object][]) {
    const operation = `${path}.${key}`;
    if (!isPolicy(entry)) {
      surface[key] = build(lifecycle, operation, entry);
      continue;
    }
    switch (entry[policyKind]) {
      case "absent":
        continue;
      case "deny":
        surface[key] = () => { throw pluginObjectAccessDenied(operation); };
        break;
      case "read": {
        const run = entry.run;
        surface[key] = (...args: unknown[]) => {
          lifecycle.signal.throwIfAborted();
          return run(...args);
        };
        break;
      }
      case "command": {
        const run = entry.run;
        surface[key] = (...args: unknown[]) => {
          lifecycle.assertActive(operation);
          return run(...args);
        };
        break;
      }
      case "observe": {
        const run = entry.run;
        surface[key] = (...args: unknown[]) => lifecycle.stage(run(...args));
        break;
      }
    }
    kinds.set(key, entry[policyKind] as RestrictedPolicyKind);
  }
  classifications.set(surface, kinds);
  return surface;
}
