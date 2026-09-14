import { AppError, type DurableJobStep, type BookTextTaskSnapshot, type BookGraphTaskSnapshot } from "@read-aware/core";
import type { DurableJobAttempt } from "../platform/durable-jobs";
import type { DomainActor } from "../platform/domain-actor";
import type { ResourceAccess } from "../services/resource-access";
import { createBookTextTaskOwner, getBookTextSnapshot } from "../features/library/lib/book-text-store";
import { createBookGraphTasks } from "./book-graph-tasks";

type BookStep = Exclude<DurableJobStep, { kind: "transaction" }>;
type Data = { kind: BookStep["kind"]; bookId: string; taskId?: string; terminal?: BookTextTaskSnapshot | BookGraphTaskSnapshot };
const attention = (code = "jobs/outcome-unknown", settled = false) => ({ status: "needs-attention" as const, code, settled });
const complete = (receipt: unknown) => ({ status: "complete" as const, receipt });
const bookStep = (step: DurableJobStep): BookStep => {
  if (step.kind === "transaction") throw new AppError("jobs/invalid-plan", "Expected a book pipeline step");
  return step;
};
const checkpointData = (step: BookStep, attempt: DurableJobAttempt): Data => {
  const data = attempt.data as Data | null;
  if (!data || data.kind !== step.kind || data.bookId !== step.bookId) throw new AppError("jobs/invalid-plan", "Book checkpoint does not match step");
  return data;
};

/** Actual existing task owners, with authority held through physical cleanup.
 * A persisted terminal snapshot can reconcile a lost runner checkpoint; absent
 * evidence for graph/rebuild work never authorizes automatic replay. */
export function durableBookSteps(actor: DomainActor, acquire: (bookId: string, signal: AbortSignal) => Promise<ResourceAccess>) {
  return {
    async prepare(input: DurableJobStep) {
      const step = bookStep(input);
      return { kind: step.kind, bookId: step.bookId } satisfies Data;
    },
    async execute(input: DurableJobStep, attempt: DurableJobAttempt, signal: AbortSignal, checkpoint: (data: unknown) => Promise<void>) {
      const step = bookStep(input), data = checkpointData(step, attempt);
      const access = await acquire(step.bookId, signal);
      const combined = AbortSignal.any([signal, access.signal]);
      const assert = () => { combined.throwIfAborted(); if (!access.isAllowed()) throw new AppError("plugin/object-access-denied", "Book task grant expired"); };
      try {
        assert();
        if (step.kind === "library.text.prepare") {
          const owner = createBookTextTaskOwner(undefined, actor);
          let taskId: string | undefined;
          try {
            const started = await owner.start(step.bookId, step.options, actor, { signal: combined, isAllowed: access.isAllowed.bind(access), dispose() {} });
            taskId = started.taskId;
            await checkpoint({ ...data, taskId });
            await owner.whenSettled(step.bookId, taskId);
            const terminal = owner.get(step.bookId, taskId);
            await checkpoint({ ...data, taskId, terminal });
            // Success is factual even if cancellation raced with the reply.
            if (terminal.status === "completed") return complete(terminal);
            return attention(terminal.errorCode ?? "jobs/step-incomplete", true);
          } finally {
            if (taskId) owner.cancel(step.bookId, taskId, actor);
            owner.dispose(); await owner.drain();
          }
        }
        const owner = createBookGraphTasks();
        let taskId: string | undefined;
        try {
          const started = await owner.start(step.bookId, step.mode, step.options, combined, actor);
          taskId = started.taskId;
          await checkpoint({ ...data, taskId });
          await owner.whenSettled(step.bookId, taskId);
          const terminal = await owner.get(step.bookId, taskId);
          await checkpoint({ ...data, taskId, terminal });
          if (terminal.status === "completed") return complete(terminal);
          return attention(terminal.errorCode ?? "jobs/step-incomplete", true);
        } finally {
          if (taskId) await owner.cancel(step.bookId, taskId, actor);
          owner.dispose(); await owner.drain();
        }
      } finally { access.dispose(); }
    },
    async reconcile(input: DurableJobStep, attempt: DurableJobAttempt, signal: AbortSignal, explicitResume: boolean) {
      const step = bookStep(input), data = checkpointData(step, attempt);
      const access = await acquire(step.bookId, signal);
      const assert = () => { signal.throwIfAborted(); access.signal.throwIfAborted(); if (!access.isAllowed()) throw new AppError("plugin/object-access-denied", "Book task grant expired"); };
      try {
        assert();
        if (data.terminal?.status === "completed") return complete(data.terminal);
        if (step.kind === "book.graph") {
          // Only a known-ended catch-up pass may be explicitly continued.
          // Rebuild target recovery needs a persisted chapter plan, not an old digest.
          return explicitResume && step.mode === "catch-up" && data.terminal
            ? { status: "ready" as const, data: { kind: step.kind, bookId: step.bookId } }
            : attention("jobs/outcome-unknown", !!data.terminal);
        }
        if (data.taskId) {
          const owner = createBookTextTaskOwner(undefined, actor);
          try {
            for (let offset = 0; offset < 64; offset += 20) {
              const page = await owner.listHistory(step.bookId, { offset, limit: 20 });
              assert();
              const found = page.items.find(item => item.snapshot.taskId === data.taskId);
              if (found?.snapshot.status === "completed") return complete(found.snapshot);
              if (found || page.nextOffset === null) break;
            }
          } finally { owner.dispose(); }
        }
        if (step.options?.rebuild) return attention("jobs/outcome-unknown", !!data.terminal);
        const snapshot = await getBookTextSnapshot(step.bookId); assert();
        if (snapshot.status === "ready") return complete(snapshot);
        // Ordinary prepare reuses current derived content and shared extraction;
        // unlike rebuild, it does not reset already committed text.
        return { status: "ready" as const, data: { kind: step.kind, bookId: step.bookId } };
      } finally { access.dispose(); }
    },
  };
}
