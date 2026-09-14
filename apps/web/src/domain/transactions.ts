import { AppError, normalizeAtomicOperations, type AtomicOperation, type AtomicPreview, type AtomicReceipt, type TransactionsPort, type SettingsAccessPolicy, type SettingChange } from "@read-aware/core";
import type { DomainActor } from "../platform/domain-actor";
import type { DomainEventDraft } from "../platform/domain-events";
import { atomicAggregateRevisions, atomicReceipt, commitAtomicHostPlan, type AtomicHostPlan, type AtomicDocumentBytes } from "../platform/atomic-commit";
import { bookMetadataPatch } from "../features/library/lib/book-metadata-patch";
import { getBookRecord } from "../features/library/lib/library-db";
import { pluginDocsGet } from "../features/plugins/runtime/plugin-backend";
import { prepareAtomicSettings, publishSettingsChanges } from "./settings/domain";

export type TransactionAuthority = {
  actor: DomainActor; owner: string; pluginId?: string; settingsAccess?: SettingsAccessPolicy;
  /** The capability owner holds book/current-book/lifecycle fences until dispose. */
  acquire(operations: AtomicOperation[], signal?: AbortSignal): Promise<{ assert(): void | Promise<void>; dispose(): void }>;
  assertDocumentBook(bookId: string | null): void | Promise<void>;
  /** Existing document observer wraps dispatch to retain causes and pending reads. */
  withDocumentWrite<T>(targets: { collection: string; id: string }[], work: () => Promise<T>): Promise<T>;
};
type Inverse = Pick<AtomicHostPlan, "events" | "settings" | "documents">;
type Metadata = { version: 1; operations: AtomicOperation[]; before: unknown[]; inverse: Inverse; settingsChanges: SettingChange[]; inverseSettingsChanges: SettingChange[]; undoOf?: string };
type Prepared = { view: AtomicPreview; plan: AtomicHostPlan; authority: Awaited<ReturnType<TransactionAuthority["acquire"]>>; timer: ReturnType<typeof setTimeout> };
const conflict = () => new AppError("transaction/conflict", "State changed; prepare a new preview");

/** One instance belongs to one Agent scope or plugin activation. Raw bytes and
 * inverse operations stay host-private; only semantic previews leave this owner. */
export class TransactionSession implements TransactionsPort {
  private plans = new Map<string, Prepared>();
  constructor(private readonly owner: TransactionAuthority) {
    if (owner.pluginId && owner.owner !== `plugin:${owner.pluginId}`) throw new AppError("transaction/invalid-operation", "Plugin receipt owner must match its private storage owner");
  }
  dispose(): void { for (const id of [...this.plans.keys()]) this.retire(id); }
  private retire(id: string): void {
    const plan = this.plans.get(id); if (!plan) return;
    this.plans.delete(id); clearTimeout(plan.timer); plan.authority.dispose();
  }
  private keep(operations: AtomicOperation[], before: unknown[], plan: AtomicHostPlan, authority: Prepared["authority"], undoOf?: string): AtomicPreview {
    if (this.plans.size >= 16) throw new AppError("transaction/quota-exceeded", "Too many pending previews");
    const view: AtomicPreview = { id: plan.journal.id, expiresAt: new Date(Date.now() + 300_000).toISOString(), operations, before, ...(undoOf ? { undoOf } : {}) };
    const timer = setTimeout(() => this.retire(view.id), 300_000);
    this.plans.set(view.id, { view, plan, authority, timer });
    return structuredClone(view);
  }
  async preview(input: AtomicOperation[], signal?: AbortSignal): Promise<AtomicPreview> {
    signal?.throwIfAborted();
    const operations = normalizeAtomicOperations(input);
    const authority = await this.owner.acquire(operations, signal);
    try {
      await authority.assert();
      const seen = new Set<string>();
      const targets = operations.flatMap(op => op.kind === "book.metadata" ? [{ aggregateType: "book", aggregateId: op.bookId }] : []);
      const revisions = await atomicAggregateRevisions(targets);
      const before: unknown[] = [], events: DomainEventDraft[] = [], inverseEvents: DomainEventDraft[] = [];
      const docs: AtomicDocumentBytes[] = [], inverseDocs: AtomicDocumentBytes[] = [];
      const settings = operations.flatMap(op => op.kind === "settings" ? op.changes : []);
      const settingPlan = settings.length ? await prepareAtomicSettings(this.owner.actor, settings, this.owner.settingsAccess) : { entries: [], changed: [], beforeValues: [] };
      for (const operation of operations) {
        signal?.throwIfAborted(); await authority.assert();
        const identity = operation.kind === "book.metadata" ? `book:${operation.bookId}` : operation.kind === "settings" ? "settings" : `document:${operation.collection}/${operation.id}`;
        if (seen.has(identity)) throw new AppError("transaction/invalid-operation", "Combine edits to the same object before preview");
        seen.add(identity);
        if (operation.kind === "book.metadata") {
          const book = await getBookRecord(operation.bookId);
          if (!book) throw new AppError("reader/book-not-found", "Book not found");
          const patch = bookMetadataPatch({ title: book.title, author: book.author ?? "" }, operation.patch);
          const old = { ...(operation.patch.title !== undefined ? { title: book.title } : {}), ...(operation.patch.author !== undefined ? { author: book.author ?? "" } : {}) };
          before.push(old);
          if (Object.keys(patch).length) {
            operation.patch = patch;
            events.push({ type: "book.metadataEdited", payload: { bookId: book.id, ...patch } });
            inverseEvents.push({ type: "book.metadataEdited", payload: { bookId: book.id, ...old } });
          }
        } else if (operation.kind === "settings") before.push(settingPlan.beforeValues);
        else {
          if (!this.owner.pluginId) throw new AppError("plugin/permission-denied", "Private document operations require a plugin owner");
          const old = await pluginDocsGet(this.owner.pluginId, operation.collection, operation.id);
          if (old) await this.owner.assertDocumentBook(old.bookId ?? null);
          if (operation.kind === "document.put") await this.owner.assertDocumentBook(operation.bookId);
          before.push(old ? { data: JSON.parse(old.json), bookId: old.bookId, anchor: old.anchor } : null);
          const target = { collection: operation.collection, id: operation.id };
          docs.push(operation.kind === "document.put" ? { ...target, expectedRevision: old?.revision ?? null, kind: "put", json: JSON.stringify(operation.data), bookId: operation.bookId, anchor: operation.anchor }
            : { ...target, expectedRevision: old?.revision ?? null, kind: "delete" });
          inverseDocs.push(old ? { ...target, expectedRevision: null, kind: "put", json: old.json, bookId: old.bookId, anchor: old.anchor }
            : { ...target, expectedRevision: null, kind: "delete" });
        }
      }
      const after = await atomicAggregateRevisions(targets);
      if (after.some((revision, index) => revision !== revisions[index])) throw conflict();
      await authority.assert(); signal?.throwIfAborted();
      if (!events.length && !settingPlan.entries.length && !docs.length) throw new AppError("transaction/no-changes", "The requested state is already present");
      const metadata: Metadata = { version: 1, operations, before, settingsChanges: settingPlan.changed, inverseSettingsChanges: settingPlan.beforeValues,
        inverse: { events: inverseEvents, settings: settingPlan.entries.map(entry => ({ key: entry.key, expected: entry.value, value: entry.expected })),
          documents: this.owner.pluginId && inverseDocs.length ? [{ pluginId: this.owner.pluginId, changes: inverseDocs }] : [] } };
      return this.keep(operations, before, { guards: targets.map((target, index) => ({ ...target, revision: revisions[index]! })), events,
        settings: settingPlan.entries, documents: this.owner.pluginId && docs.length ? [{ pluginId: this.owner.pluginId, changes: docs }] : [],
        journal: { id: crypto.randomUUID(), owner: this.owner.owner, metadata } }, authority);
    } catch (error) { authority.dispose(); throw error; }
  }
  async commit(id: string, signal?: AbortSignal): Promise<AtomicReceipt> {
    const prepared = this.plans.get(id);
    if (!prepared) throw new AppError("transaction/preview-expired", "Preview expired; prepare again");
    // Consume once, before awaiting. Durable receipt lookup resolves lost replies.
    this.plans.delete(id); clearTimeout(prepared.timer);
    const metadata = prepared.plan.journal.metadata as Metadata;
    try {
      await this.owner.withDocumentWrite(prepared.plan.documents.flatMap(group => group.changes), () => commitAtomicHostPlan(prepared.plan, this.owner.actor, {
        signal, assertAuthorized: () => prepared.authority.assert(),
        committed: () => publishSettingsChanges(this.owner.actor, metadata.settingsChanges),
      }));
      return { id, committed: true, ...(metadata.undoOf ? { undoOf: metadata.undoOf } : {}) };
    } finally { prepared.authority.dispose(); }
  }
  async receipt(id: string, signal?: AbortSignal): Promise<AtomicReceipt | null> {
    signal?.throwIfAborted();
    const record = await atomicReceipt(this.owner.owner, id);
    if (!record) return null;
    const metadata = record.metadata as Metadata;
    const authority = await this.owner.acquire(normalizeAtomicOperations(metadata.operations), signal);
    try { await authority.assert(); return { id, committed: true, ...(metadata.undoOf ? { undoOf: metadata.undoOf } : {}) }; }
    finally { authority.dispose(); }
  }
  async previewUndo(id: string, signal?: AbortSignal): Promise<AtomicPreview> {
    signal?.throwIfAborted();
    const record = await atomicReceipt(this.owner.owner, id);
    if (!record) throw new AppError("transaction/receipt-missing", "Receipt not found for this owner");
    const metadata = record.metadata as Metadata;
    if (metadata.version !== 1) throw new AppError("transaction/invalid-operation", "Unsupported receipt version");
    const operations = normalizeAtomicOperations(metadata.operations);
    const authority = await this.owner.acquire(operations, signal);
    try {
      await authority.assert();
      const inverse = structuredClone(metadata.inverse);
      for (const [groupIndex, group] of inverse.documents.entries()) {
        if (group.pluginId !== this.owner.pluginId) throw new AppError("plugin/permission-denied", "Receipt belongs to another plugin");
        for (const [index, change] of group.changes.entries()) {
          const receipt = record.receipt.documents[groupIndex]?.documents[index];
          if (!receipt || receipt.collection !== change.collection || receipt.id !== change.id) throw conflict();
          change.expectedRevision = receipt.revision;
          const current = await pluginDocsGet(group.pluginId, change.collection, change.id);
          await this.owner.assertDocumentBook(current?.bookId ?? null);
          if (change.kind === "put") await this.owner.assertDocumentBook(change.bookId ?? null);
        }
      }
      // Inverse bytes restore exact override presence and private document data.
      // Native compares the post-commit guards/bytes/revisions before any write.
      const undoMetadata: Metadata = { ...metadata, undoOf: id, settingsChanges: metadata.inverseSettingsChanges, inverse: { events: [], settings: [], documents: [] } };
      if (metadata.undoOf) throw new AppError("transaction/invalid-operation", "Prepare a new semantic operation to redo a change");
      const undoOperations: AtomicOperation[] = operations.map((operation, index) => {
        if (operation.kind === "book.metadata") return { ...operation, patch: metadata.before[index] as { title?: string; author?: string } };
        if (operation.kind === "settings") return { kind: "settings", changes: metadata.inverseSettingsChanges };
        const old = metadata.before[index] as { data: unknown; bookId: string | null; anchor?: string | null } | null;
        return old ? { kind: "document.put", collection: operation.collection, id: operation.id, data: old.data, bookId: old.bookId, ...(old.anchor ? { anchor: old.anchor } : {}) }
          : { kind: "document.delete", collection: operation.collection, id: operation.id };
      });
      return this.keep(undoOperations, operations, { ...inverse, guards: record.revisions,
        journal: { id: crypto.randomUUID(), owner: this.owner.owner, metadata: undoMetadata } }, authority, id);
    } catch (error) { authority.dispose(); throw error; }
  }
}
