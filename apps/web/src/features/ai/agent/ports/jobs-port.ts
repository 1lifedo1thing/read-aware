import { invoke } from "../../../../platform/ipc";
import { isTauri } from "../../../../platform/environment";
import { AppError, type DurableJobPlan, type DurableJobsPort } from "@read-aware/core";
import { threadScopeKey, type ThreadScope } from "@read-aware/agent";
import { DurableJobRunner } from "../../../../domain/durable-jobs";
import { createDurableJobExecutor } from "../../../../domain/durable-job-executor";
import { nativeDurableJobStore } from "../../../../platform/durable-jobs";
import { createLogger } from "../../../../platform/logger";
import { createAgentTransactions } from "./transactions-port";

// Model configuration changes must not create a second owner of running jobs.
const runners = new Map<string, DurableJobRunner>();
let generation = 0, stopping = false;
const transactionsFor = createAgentTransactions();
const log = createLogger("agent-jobs");
function runnerFor(scope: ThreadScope): DurableJobRunner {
  if (stopping) throw new AppError("jobs/unavailable", "Agent jobs are stopping");
  const key = threadScopeKey(scope), existing = runners.get(key);
  if (existing) { runners.delete(key); runners.set(key, existing); return existing; }
  if (runners.size >= 256) {
    const idle = [...runners].find(([, runner]) => !runner.active);
    if (!idle) throw new AppError("jobs/quota-exceeded", "Too many active Agent task scopes");
    runners.delete(idle[0]); void idle[1].stop();
  }
  const transactions = transactionsFor(scope);
  const assertBook = (bookId: string) => {
    if (scope.kind === "book" && bookId !== scope.bookId) throw new AppError("plugin/object-access-denied", "Job is outside the conversation book");
  };
  const acquireBook = async (bookId: string, signal: AbortSignal) => {
    signal.throwIfAborted(); assertBook(bookId);
    return { signal, isAllowed: () => !signal.aborted && (scope.kind !== "book" || scope.bookId === bookId), dispose() {} };
  };
  const authorize = async (plan: DurableJobPlan, signal: AbortSignal) => {
    signal.throwIfAborted();
    const grants: Array<{ assert(): void | Promise<void>; dispose(): void }> = [];
    try {
      for (const step of plan.steps) {
        if (step.kind === "transaction") grants.push(await transactions.authorizeDurableOperations(step.operations, signal));
        else assertBook(step.bookId);
      }
      return { assert: async () => { signal.throwIfAborted(); for (const grant of grants) await grant.assert(); }, dispose: () => { for (const grant of grants) grant.dispose(); } };
    } catch (error) { for (const grant of grants) grant.dispose(); throw error; }
  };
  const runner = new DurableJobRunner(nativeDurableJobStore(`agent:${key}`), createDurableJobExecutor({
    actor: "agent", transactions, authorize, acquireBook, report: error => log.error("Saved Agent task failed", error),
  }));
  runners.set(key, runner);
  void runner.recover().catch(error => log.error("Saved Agent task recovery failed", error));
  return runner;
}

/** Building tool catalogs does not itself start or allocate work. */
export function agentJobs(scope: ThreadScope): DurableJobsPort & { inspectPlan(id: string): Promise<DurableJobPlan> } {
  return {
    start: (plan, signal) => runnerFor(scope).start(plan, signal),
    get: (id, signal) => runnerFor(scope).get(id, signal),
    list: (query, signal) => runnerFor(scope).list(query, signal),
    control: (id, action, signal) => runnerFor(scope).control(id, action, signal),
    inspectPlan: id => runnerFor(scope).inspectPlan(id),
  };
}
export async function recoverAgentJobs(): Promise<void> {
  if (!isTauri()) return;
  const started = generation;
  const owners = await invoke<string[]>("durable_agent_job_owners");
  if (started !== generation || stopping) return;
  for (const owner of owners) {
    const key = owner.slice(6);
    if (key.startsWith("book:") && key.length > 5) runnerFor({ kind: "book", bookId: key.slice(5) });
    else if (key.startsWith("global:") && key.length > 7) runnerFor({ kind: "global", threadId: key.slice(7) });
  }
}
export async function stopAgentJobs(): Promise<void> {
  generation++; stopping = true;
  const active = [...runners.values()];
  try { await Promise.all(active.map(runner => runner.stop())); }
  finally { runners.clear(); stopping = false; }
}
