import type { DomainActor } from "../platform/domain-actor";
import type { ResourceAccess } from "../services/resource-access";
import type { TransactionSession } from "./transactions";
import type { DurableJobExecutor } from "./durable-jobs";
import { durableTransactionStep } from "./durable-transaction-step";
import { durableBookSteps } from "./durable-book-steps";

/** One owner supplies the same grants used by its ordinary capability ports.
 * Startup recovery and interactive calls use this identical dispatcher. */
export function createDurableJobExecutor(options: {
  actor: DomainActor;
  transactions: TransactionSession;
  authorize: DurableJobExecutor["authorize"];
  acquireBook(bookId: string, signal: AbortSignal): Promise<ResourceAccess>;
  report(error: unknown): void;
}): DurableJobExecutor {
  const transactions = durableTransactionStep(options.transactions);
  const books = durableBookSteps(options.actor, options.acquireBook);
  return {
    authorize: options.authorize,
    report: options.report,
    prepare: (step, id, signal) => step.kind === "transaction" ? transactions.prepare(step, id, signal) : books.prepare(step),
    execute: (step, attempt, signal, checkpoint) => step.kind === "transaction"
      ? transactions.execute(step, attempt, signal) : books.execute(step, attempt, signal, checkpoint),
    reconcile: (step, attempt, signal, explicitResume) => step.kind === "transaction"
      ? transactions.reconcile(step, attempt, signal) : books.reconcile(step, attempt, signal, explicitResume),
  };
}
