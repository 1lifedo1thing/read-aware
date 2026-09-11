import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";
import { createLogger } from "../../../platform/logger";
import type { ContributionId } from "@read-aware/core";
import type { ContributionKey, PluginDisposable } from "../lib/plugin-types";
import { publishContributionChange, undoContributionReplacement } from "./contribution-activation";

export type ContributionIdentity = {
  key: ContributionKey;
  pluginId: string;
};

export type ContributionPoint = ContributionId;

export type ContributionRegistration = PluginDisposable & { isCurrent(): boolean };

export type ContributionSnapshot = {
  point: ContributionPoint;
  key: ContributionKey;
  pluginId: string;
};

export type ContributionRegistry<T extends ContributionIdentity> = {
  readonly point: ContributionPoint;
  readonly atom: PrimitiveAtom<T[]>;
  register(item: T): ContributionRegistration;
  list(): T[];
  find(predicate: (item: T) => boolean): T | null;
  update(key: ContributionKey, update: (item: T) => T): T | null;
};

type InspectableRegistry = {
  point: ContributionPoint;
  list(): ContributionIdentity[];
};

const registries = new Map<ContributionPoint, InspectableRegistry>();
const listeners = new Set<() => void>();
const log = createLogger("contribution-registry");

/** Registry changes only; observers never receive provider objects or callbacks. */
export function subscribeContributions(listener: () => void): () => void {
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
  let entries: T[] = [];
  const publish = () => publishContributionChange(entriesAtom, () => {
    const published = store.get(entriesAtom);
    if (published.length !== entries.length || published.some((item, index) => item !== entries[index])) {
      store.set(entriesAtom, entries);
    }
  });
  const registry: ContributionRegistry<T> = {
    point,
    atom: entriesAtom,
    register(item) {
      validateIdentity(item);
      const owner = { disposed: false };
      const previousOwner = owners.get(item.key);
      const previousIndex = entries.findIndex(entry => entry.key === item.key);
      const previous = entries[previousIndex];
      undoContributionReplacement(() => {
        // Disposal is irreversible: never resurrect an explicitly retired owner.
        if (owners.has(item.key) && owners.get(item.key) !== owner) return;
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
      publish();
      return {
        isCurrent: () => !owner.disposed && owners.get(item.key) === owner,
        dispose: () => {
          if (owner.disposed) return;
          owner.disposed = true;
          if (owners.get(item.key) !== owner) return;
          owners.delete(item.key);
          entries = entries.filter((entry) => entry.key !== item.key);
          publish();
        },
      };
    },
    list: () => entries,
    find: (predicate) => entries.find(predicate) ?? null,
    update: (key, update) => {
      let updated: T | null = null;
      entries = entries.map((entry) => {
        if (entry.key !== key) return entry;
        updated = update(entry);
        if (updated.key !== entry.key || updated.pluginId !== entry.pluginId) {
          throw new Error("Contribution updates cannot transfer registration ownership");
        }
        return updated;
      });
      publish();
      return updated;
    },
  };
  if (catalog) {
    registries.set(point, { point, list: () => registry.list() });
    store.sub(entriesAtom, () => {
      for (const notify of [...listeners]) {
        try { notify(); } catch (error) { log.warn("Contribution observer failed", error); }
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
