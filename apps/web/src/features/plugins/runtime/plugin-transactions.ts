import { AppError, type AtomicOperation, type SettingsAccessPolicy } from "@read-aware/core";
import type { PluginManifest } from "@read-aware/plugin-types";
import { TransactionSession } from "../../../domain/transactions";
import type { PluginBookAccessFence, PluginBookAccessPolicy } from "../../../domain/plugin-object-access";
import { actorCause, type DomainActor } from "../../../platform/domain-actor";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import type { PluginDocumentObserver } from "./plugin-document-observer";

export function createPluginTransactions(manifest: PluginManifest, access: PluginBookAccessPolicy,
  lifecycle: PluginLifecycleController, observer: PluginDocumentObserver, actor: DomainActor, settingsAccess: SettingsAccessPolicy, budget: { pending: number }) {
  const permissions = new Set(manifest.permissions ?? []);
  const deny = () => new AppError("plugin/permission-denied", "Transaction operation is not granted");
  const assertLive = () => { lifecycle.assertActive("services.transactions"); lifecycle.signal.throwIfAborted(); actorCause(actor); };
  const authorize = (operations: AtomicOperation[]) => {
    assertLive();
    for (const op of operations) {
      if (op.kind === "book.metadata") {
        if (!permissions.has("library:write")) throw deny();
        access.assertBook(op.bookId, "transaction book metadata");
      } else if (op.kind === "settings") {
        for (const change of op.changes) {
          if (change.target?.kind === "book") access.assertBook(change.target.bookId, "transaction setting");
          else if (access.restricted) throw deny();
          const allowed = settingsAccess.write ?? [];
          if (!allowed.some(path => path === "*" || path === change.path || path.endsWith(".*") && change.path.startsWith(path.slice(0, -1)))) throw deny();
        }
      } else if (op.kind === "document.put") access.assertReturnedBook(op.bookId, "transaction private document");
    }
  };
  let observing = false;
  const retire = () => session.dispose();
  const session = new TransactionSession({
    reservePreview: () => { if (budget.pending >= 16) throw new AppError("transaction/quota-exceeded", "Too many previews in this activation"); budget.pending++; },
    releasePreview: () => { budget.pending--; },
    onPending: () => { if (!observing) { observing = true; lifecycle.signal.addEventListener("abort", retire, { once: true }); } },
    onIdle: () => { observing = false; lifecycle.signal.removeEventListener("abort", retire); },
    actor, owner: `plugin:${manifest.id}`, pluginId: manifest.id, settingsAccess,
    acquire: async (operations, signal) => {
      authorize(operations); signal?.throwIfAborted();
      const fences: PluginBookAccessFence[] = [];
      try {
        if (access.grant.mode === "current") fences.push(await access.beginCurrent("transaction"));
        const books = [...new Set(operations.flatMap(op => op.kind === "book.metadata" ? [op.bookId]
          : op.kind === "settings" ? op.changes.flatMap(change => change.target?.kind === "book" ? [change.target.bookId] : [])
          : op.kind === "document.put" && op.bookId ? [op.bookId] : []))];
        for (const book of books) fences.push(await access.beginBook(book, "transaction"));
        signal?.throwIfAborted();
        return { assert: async () => { authorize(operations); for (const fence of fences) await fence.assertUnchanged({ retain: true }); assertLive(); },
          dispose: () => { for (const fence of fences) fence.dispose(); } };
      } catch (error) { for (const fence of fences) fence.dispose(); throw error; }
    },
    assertDocumentBook: bookId => { assertLive(); access.assertReturnedBook(bookId, "transaction private document"); },
    withDocumentWrite: (targets, work, source) => observer.write(targets, source ?? actor, work),
  });
  return session;
}
