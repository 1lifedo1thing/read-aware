import { AppError, type EntityAlias, type EntityIdentity, type EntityPage, type IdentityConsolidationSnapshot } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { identityBytes, type IdentityClass } from "./identity-input";
import { invalid, record } from "./identity-batch-state";

export type RegistryCursor = { identityOffset: number; kind: "members" | "aliases"; offset: number };
export type RegistryRef = { entityId: string; canonicalId: string };
export type RegistryPartition = { root: EntityIdentity; kind: "members" | "aliases"; items: (EntityIdentity | EntityAlias)[]; offset: number };
const conflict = (): never => { throw new AppError("memory/conflict", "Registry changed during partition assembly"); };
const text = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
function identity(value: EntityIdentity): EntityIdentity {
  if (!record(value) || !text(value.id, 256) || value.definition !== null && (!record(value.definition)
    || !text(value.definition.kind, 64) || !text(value.definition.canonicalName, 512))) return invalid();
  return { id: value.id, definition: value.definition === null ? null : { kind: value.definition.kind, canonicalName: value.definition.canonicalName } };
}
function checkPage(page: EntityPage, revision: string, offset: number) {
  if (page.revision !== revision || page.offset !== offset || !Number.isSafeInteger(page.total) || page.total < offset
    || page.items.length > page.total - offset
    || (page.nextOffset === null ? offset + page.items.length !== page.total : page.nextOffset !== offset + page.items.length || page.nextOffset <= offset)) return conflict();
}

/** Every root, original member and alias is consumed, using the existing revision-pinned public query. */
export async function nextRegistryPartition(snapshot: IdentityConsolidationSnapshot, registry: RuntimeDeps["entityRegistry"], cursor: RegistryCursor,
  maxBytes: number, signal?: AbortSignal): Promise<{ partition: RegistryPartition; cursor: RegistryCursor } | null> {
  const expectedRevision = snapshot.entitiesRevision;
  signal?.throwIfAborted();
  const roots = await registry.query({ kind: "identities", offset: cursor.identityOffset, limit: 1, expectedRevision }, signal);
  checkPage(roots, expectedRevision, cursor.identityOffset);
  if (roots.kind !== "identities") return conflict();
  if (!roots.items.length) return null;
  const root = identity(roots.items[0]!);
  const page = await registry.query({ kind: cursor.kind, entityId: root.id, offset: cursor.offset, limit: 100, expectedRevision }, signal);
  checkPage(page, expectedRevision, cursor.offset);
  if (page.kind !== cursor.kind || page.canonicalId !== root.id) return conflict();
  const partition: RegistryPartition = { root, kind: cursor.kind, items: [], offset: cursor.offset };
  if (identityBytes(JSON.stringify(partition)) > maxBytes) return invalid();
  for (const item of page.items) {
    let captured: EntityAlias | EntityIdentity;
    if ("alias" in item) {
      if (!text(item.entityId, 256) || !text(item.alias, 512)) return invalid();
      captured = { entityId: item.entityId, alias: item.alias };
    } else captured = identity(item);
    partition.items.push(captured);
    if (identityBytes(JSON.stringify(partition)) > maxBytes) { partition.items.pop(); break; }
  }
  if (page.items.length && !partition.items.length) return invalid();
  const nextOffset = partition.items.length < page.items.length ? cursor.offset + partition.items.length : page.nextOffset;
  const next: RegistryCursor = nextOffset !== null ? { ...cursor, offset: nextOffset }
    : cursor.kind === "members" ? { ...cursor, kind: "aliases", offset: 0 }
    : { identityOffset: cursor.identityOffset + 1, kind: "members", offset: 0 };
  signal?.throwIfAborted();
  return { partition, cursor: next };
}

export function partitionRefs(partition: RegistryPartition): RegistryRef[] {
  return [{ entityId: partition.root.id, canonicalId: partition.root.id }, ...partition.items.map(item => ({
    entityId: "alias" in item ? item.entityId : item.id, canonicalId: partition.root.id,
  }))];
}

/** Rehydrate exact selected member definitions; inferred summaries never mint registry identities. */
export async function selectedIdentityClasses(snapshot: IdentityConsolidationSnapshot, registry: RuntimeDeps["entityRegistry"], refs: RegistryRef[], signal?: AbortSignal): Promise<IdentityClass[]> {
  const classes = new Map<string, IdentityClass>();
  for (const ref of refs) {
    let offset = 0;
    while (true) {
      signal?.throwIfAborted();
      const page = await registry.query({ kind: "members", entityId: ref.entityId, offset, limit: 100, expectedRevision: snapshot.entitiesRevision }, signal);
      checkPage(page, snapshot.entitiesRevision, offset);
      if (page.kind !== "members" || page.canonicalId !== ref.canonicalId) return conflict();
      const member = page.items.find(item => item.id === ref.entityId);
      if (member) {
        const root = identity({ id: ref.canonicalId, definition: page.canonicalDefinition });
        const group = classes.get(root.id) ?? { ...root, members: [], aliases: [] };
        if (!group.members.some(item => item.id === member.id)) group.members.push(identity(member));
        classes.set(root.id, group); break;
      }
      if (page.nextOffset === null) return conflict();
      offset = page.nextOffset;
    }
  }
  return [...classes.values()];
}
