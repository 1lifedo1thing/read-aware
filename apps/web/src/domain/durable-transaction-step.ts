import { AppError, type DurableJobStep } from "@read-aware/core";
import type { FrozenAtomicHostPlan } from "../platform/atomic-commit";
import type { DurableJobAttempt } from "../platform/durable-jobs";
import type { TransactionSession } from "./transactions";

/** Host pipeline adapter: raw plans stay in owner-bound checkpoints. The public
 * job plan contains semantic operations only. */
export function durableTransactionStep(session: TransactionSession) {
  const operations = (step: DurableJobStep) => {
    if (step.kind !== "transaction") throw new AppError("jobs/invalid-plan", "Expected a transaction step");
    return step.operations;
  };
  const frozen = (attempt: DurableJobAttempt): FrozenAtomicHostPlan => {
    const data = attempt.data as { kind?: string; frozen?: FrozenAtomicHostPlan } | null;
    if (data?.kind !== "transaction" || !data.frozen || data.frozen.plan.journal.id !== attempt.dispatchId) {
      throw new AppError("jobs/invalid-plan", "Invalid transaction checkpoint");
    }
    return data.frozen;
  };
  return {
    async prepare(step: DurableJobStep, dispatchId: string, signal: AbortSignal) {
      return { kind: "transaction", frozen: await session.prepareDurable(operations(step), dispatchId, signal) };
    },
    async execute(step: DurableJobStep, attempt: DurableJobAttempt, signal: AbortSignal) {
      operations(step);
      const receipt = await session.commitDurable(frozen(attempt), signal);
      return { status: "complete" as const, receipt };
    },
    async reconcile(step: DurableJobStep, attempt: DurableJobAttempt, signal: AbortSignal) {
      operations(step); frozen(attempt);
      const receipt = await session.receipt(attempt.dispatchId, signal);
      if (receipt) return { status: "complete" as const, receipt };
      // A missing receipt alone does not prove no write is in flight. Reusing
      // the frozen native request is safe because its identity is idempotent.
      // The runner must still retain unknown status when cancel was requested.
      return { status: "ready" as const, data: attempt.data };
    },
  };
}
