import { AppError } from "@read-aware/core";
import { actorCause, type DomainActor } from "./domain-actor";
import { broadcastDomainEvents, prepareAtomicEventRows, type DomainEventDraft, type CommitReport } from "./domain-events";
import { commitLocalKVTransaction } from "./local-store";
import { withPluginDataWrites } from "./plugin-data-access";
import { runDomainWrite } from "./domain-write-gate";
import { isTauri } from "./environment";
import { createLogger } from "./logger";
import { invoke } from "./ipc";

export type AtomicAggregateGuard = { aggregateType: string; aggregateId: string; revision: string };
export type AtomicSettingBytes = { key: string; expected: string | null; value: string | null };
export type AtomicDocumentBytes = { collection: string; id: string; expectedRevision: string | null } & (
  | { kind: "put"; json: string; bookId?: string | null; anchor?: string | null }
  | { kind: "delete" | "check" }
);
export type AtomicDocumentReceipt = { collection: string; id: string; revision: string | null };
export type AtomicCommitReceipt = { status: "applied"; events: CommitReport; documents: { status: "applied"; documents: AtomicDocumentReceipt[] }[] };
type NativeResult = AtomicCommitReceipt | { status: "conflict"; domain: string; index: number };
export type AtomicJournalRecord = { id: string; metadata: unknown; receipt: AtomicCommitReceipt; revisions: AtomicAggregateGuard[] };

/** Host-only wire. Semantic capability owners must authorize every target and
 * build these bytes; neither the Agent nor a Worker receives this interface. */
export type AtomicHostPlan = {
  guards: AtomicAggregateGuard[];
  settingGuards?: AtomicSettingBytes[];
  events: DomainEventDraft[];
  settings: AtomicSettingBytes[];
  documents: { pluginId: string; changes: AtomicDocumentBytes[] }[];
  journal: { id: string; owner: string; metadata: unknown };
};

export function atomicAggregateRevisions(aggregates: { aggregateType: string; aggregateId: string }[]): Promise<string[]> {
  if (!isTauri()) return Promise.reject(new AppError("plugin/unavailable", "Atomic transactions require desktop"));
  return invoke("atomic_aggregate_revisions", { aggregates: aggregates.map(item => [item.aggregateType, item.aggregateId]) });
}
export function atomicReceipt(owner: string, id: string): Promise<AtomicJournalRecord | null> {
  if (!isTauri()) return Promise.reject(new AppError("plugin/unavailable", "Atomic transactions require desktop"));
  return invoke("atomic_receipt_get", { owner, id });
}

export async function commitAtomicHostPlan(plan: AtomicHostPlan, actor: DomainActor, options: {
  signal?: AbortSignal;
  assertAuthorized(): void | Promise<void>;
  /** Publish semantic settings/document notifications only after known success. */
  committed(receipt: AtomicCommitReceipt): void;
}): Promise<AtomicCommitReceipt> {
  if (!isTauri()) throw new AppError("plugin/unavailable", "Atomic transactions require desktop");
  actorCause(actor); options.signal?.throwIfAborted();
  const frozen = structuredClone({ ...plan, events: plan.events.map(({ origin: _, ...event }) => event) });
  const drafts = frozen.events.map(event => ({ ...event, origin: actor })) as DomainEventDraft[];
  const owners = [...new Set([...frozen.documents.map(group => group.pluginId),
    ...frozen.settings.flatMap(entry => /^read-aware-plugin\.([a-z0-9-]+)\.settings$/.exec(entry.key)?.[1] ?? [])])];
  return withPluginDataWrites(owners, () => runDomainWrite(async () => {
    await options.assertAuthorized();
    const events = await prepareAtomicEventRows(drafts);
    let receipt: AtomicCommitReceipt | undefined;
    const persist = async () => {
      options.signal?.throwIfAborted(); await options.assertAuthorized(); options.signal?.throwIfAborted();
      const result = await invoke<NativeResult>("atomic_commit", { input: { ...frozen, events } });
      if (result.status === "conflict") throw new AppError("transaction/conflict", `Preview changed: ${result.domain}/${result.index}`);
      receipt = result;
    };
    if (frozen.settings.length) await commitLocalKVTransaction(new Map(frozen.settings.map(entry => [entry.key, entry.value])), persist, actor);
    else await persist();
    if (!receipt) throw new AppError("transaction/receipt-missing", "Transaction completed without a receipt");
    // Once native commit succeeds, cancellation cannot pretend it was undone.
    broadcastDomainEvents(drafts);
    try { options.committed(receipt); } catch (error) { createLogger("atomic-commit").error("Committed transaction observer failed", error); }
    return receipt;
  }));
}
