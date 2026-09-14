import { AppError } from "@read-aware/core";
import { threadScopeKey, type ThreadScope } from "@read-aware/agent";
import { TransactionSession } from "../../../../domain/transactions";

export function createAgentTransactions() {
  const sessions = new Map<string, TransactionSession>();
  return (scope: ThreadScope): TransactionSession => {
    const key = threadScopeKey(scope);
    const existing = sessions.get(key);
    if (existing) { sessions.delete(key); sessions.set(key, existing); return existing; }
    if (sessions.size >= 64) {
      const oldest = sessions.keys().next().value!;
      sessions.get(oldest)!.dispose(); sessions.delete(oldest);
    }
    const session = new TransactionSession({ actor: "agent", owner: `agent:${key}`,
      acquire: async (operations, signal) => {
        signal?.throwIfAborted();
        const assert = () => {
          for (const op of operations) {
            if (op.kind === "document.put" || op.kind === "document.delete" || op.kind === "document.check") throw new AppError("plugin/permission-denied", "Agent transactions do not own plugin private data");
            if (scope.kind !== "book") continue;
            if (op.kind === "book.metadata" && op.bookId !== scope.bookId) throw new AppError("plugin/object-access-denied", "Transaction is outside the conversation book");
            if (op.kind === "settings" && op.changes.some(change => change.target?.kind !== "book" || change.target.bookId !== scope.bookId)) {
              throw new AppError("plugin/object-access-denied", "Book conversations may only change this book's settings");
            }
          }
        };
        assert(); return { assert, dispose: () => {} };
      },
      assertDocumentBook: () => { throw new AppError("plugin/permission-denied", "No private document authority"); },
      withDocumentWrite: (_targets, work) => work(),
    });
    sessions.set(key, session); return session;
  };
}
