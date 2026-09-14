import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";
import { createLogger } from "../../../platform/logger";
import type { ContributionId } from "@read-aware/core";
import type { ContributionKey } from "../lib/plugin-types";
import { publishContributionChange, undoContributionReplacement } from "./contribution-activation";
import { causalActor, mergeEventCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";

export type ContributionIdentity = {
  key: ContributionKey;
  pluginId: string;
};

export type ContributionPoint = ContributionId;

export type ContributionRegistration = { dispose(source?: DomainActor): void; isCurrent(): boolean };

export type ContributionSnapshot = {
  point: ContributionPoint;
  key: ContributionKey;
  pluginId: string;
};

export type ContributionRegistry<T extends ContributionIdentity> = {
  readonly point: ContributionPoint;
  readonly atom: PrimitiveAtom<T[]>;
  register(item: T, source?: DomainActor): ContributionRegistration;
  list(): T[];
  find(predicate: (item: T) => boolean): T | null;
  update(key: ContributionKey, update: (item: T) => T, source?: DomainActor): T | null;
};

type InspectableRegistry = {
  point: ContributionPoint;
  list(): ContributionIdentity[];
};

const registries = new Map<ContributionPoint, InspectableRegistry>();
const listeners = new Set<(source: object) => void>();
const log = createLogger("contribution-registry");

/** Registry changes only; observers never receive provider objects or callbacks. */
export function subscribeContributions(listener: (source: object) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function validateIdentity(item: ContributionIdentity): void {
  const pluginId = String(item.pluginId).trim();
  if (!pluginId || !String(item.key).startsWith(`${pluginId}:`)) {
    throw new Error(`contribution key must be owned by plugin "${pluginId}"`);
  }
}

/** Shared ownership, replacement, disposal, and inspection for every point. */
export function createContributionRegistry<T extends ContributionIdentity>(
  point: ContributionPoint,
  options: { catalog?: boolean } = {},
): ContributionRegistry<T> {
  const catalog = options.catalog !== false;
  if (catalog && registries.has(point)) {
    throw new Error(`contribution point is already registered: ${point}`);
  }
  const entriesAtom = atom<T[]>([]);
  const store = getDefaultStore();
  const owners = new Map<ContributionKey, { disposed: boolean }>();
  let publishedOwners = new Map<ContributionKey, object>();
  let entries: T[] = [];
  const pending = new Map<object, object>();
  const publish = () => publishContributionChange(entriesAtom, () => {
    const published = store.get(entriesAtom);
    const before = new Map(published.map(item => [item.key, item]));
    const sources: object[] = [];
    for (const item of entries) {
      if (before.get(item.key) !== item || publishedOwners.get(item.key) !== owners.get(item.key)) {
        const source = pending.get(owners.get(item.key)!);
        if (source) sources.push(source);
      }
      before.delete(item.key);
    }
    for (const key of before.keys()) {
      const source = pending.get(publishedOwners.get(key)!);
      if (source) sources.push(source);
    }
    const changed = published.length !== entries.length || published.some((item, index) => item !== entries[index]
      || publishedOwners.get(item.key) !== owners.get(item.key));
    // Only owners visible in the final delta contribute causes. A failed
    // nested registration cannot add a fresh branch to a successful parent.
    const snapshot = mergeEventCauses(sources, [...entries]);
    pending.clear(); publishedOwners = new Map(owners);
    if (changed) store.set(entriesAtom, snapshot);
  });
  const change = (owner: object, source: DomainActor) => { pending.set(owner, stampEventCause({}, source)); publish(); };
  const registry: ContributionRegistry<T> = {
    point,
    atom: entriesAtom,
    register(item, source = "system") {
      validateIdentity(item);
      const origin = causalActor(source);
      const owner = { disposed: false };
      const previousOwner = owners.get(item.key);
      const previousIndex = entries.findIndex(entry => entry.key === item.key);
      const previous = entries[previousIndex];
      undoContributionReplacement(() => {
        // Disposal is irreversible: never resurrect an explicitly retired owner.
        if (owners.has(item.key) && owners.get(item.key) !== owner) return;
        pending.delete(owner);
        owners.delete(item.key);
        entries = entries.filter(entry => entry.key !== item.key);
        if (previous && previousOwner && !previousOwner.disposed) {
          owners.set(item.key, previousOwner);
          entries.splice(Math.min(previousIndex, entries.length), 0, previous);
        }
        publish();
      });
      owners.set(item.key, owner);
      entries = [
        ...entries.filter((entry) => entry.key !== item.key),
        item,
      ];
      change(owner, origin);
      return {
        isCurrent: () => !owner.disposed && owners.get(item.key) === owner,
        dispose: (source = origin) => {
          if (owner.disposed) return;
          const retirement = causalActor(source);
          owner.disposed = true;
          if (owners.get(item.key) !== owner) { change(owner, retirement); return; }
          owners.delete(item.key);
          entries = entries.filter((entry) => entry.key !== item.key);
          change(owner, retirement);
        },
      };
    },
    list: () => entries,
    find: (predicate) => entries.find(predicate) ?? null,
    update: (key, update, source = "system") => {
      const origin = causalActor(source), previous = entries;
      let updated: T | null = null;
      entries = entries.map((entry) => {
        if (entry.key !== key) return entry;
        updated = update(entry);
        if (updated.key !== entry.key || updated.pluginId !== entry.pluginId) {
          throw new Error("Contribution updates cannot transfer registration ownership");
        }
        return updated;
      });
      if (entries.some((entry, index) => entry !== previous[index])) change(owners.get(key)!, origin);
      return updated;
    },
  };
  if (catalog) {
    registries.set(point, { point, list: () => registry.list() });
    store.sub(entriesAtom, () => {
      const source = store.get(entriesAtom);
      for (const notify of [...listeners]) {
        if (store.get(entriesAtom) !== source) break;
        try { notify(source); } catch (error) { log.warn("Contribution observer failed", error); }
      }
    });
  }
  return registry;
}

export function inspectContributions(pluginId?: string): ContributionSnapshot[] {
  return [...registries.values()].flatMap((registry) =>
    registry
      .list()
      .filter((entry) => !pluginId || entry.pluginId === pluginId)
      .map((entry) => ({
        point: registry.point,
        key: entry.key,
        pluginId: entry.pluginId,
      })),
  );
}
