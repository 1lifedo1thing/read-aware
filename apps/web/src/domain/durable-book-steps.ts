import { getDigestContentVersion, prepareDurableDigestWrite, commitDurableDigestWrite, durableDigestReceipt, type DurableDigestWrite } from "./book-digest";
import { AppError, type DurableJobStep, type BookTextTaskSnapshot, type BookGraphTaskSnapshot } from "@read-aware/core";
import type { DurableJobAttempt } from "../platform/durable-jobs";
import type { DomainActor } from "../platform/domain-actor";
import type { ResourceAccess } from "../services/resource-access";
import { createBookTextTaskOwner, getBookTextSnapshot } from "../features/library/lib/book-text-store";
import { createBookGraphTasks } from "./book-graph-tasks";

type BookStep = Exclude<DurableJobStep, { kind: "transaction" }>;
type GraphCheckpoint = { contentVersion: string; targets: number[]; completed: number[]; writes: Record<string, DurableDigestWrite> };
type Data = { graph?: GraphCheckpoint; kind: BookStep["kind"]; bookId: string; taskId?: string; terminal?: BookTextTaskSnapshot | BookGraphTaskSnapshot };
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
      const cancellation = new AbortController();
      const combined = AbortSignal.any([signal, access.signal, cancellation.signal]);
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
        let saved = structuredClone(data), updates = Promise.resolve();
        const update = (change: (current: Data) => Data) => {
          const work = updates.then(async () => { const next = change(saved); await checkpoint(next); saved = next; });
          updates = work;
          return work.catch(error => { cancellation.abort(error); throw error; });
        };
        const owner = createBookGraphTasks(undefined, undefined, {
          targets: saved.graph?.targets.filter(index => !saved.graph!.completed.includes(index)),
          preparedDigest: async chapter => {
            const write = saved.graph?.writes[chapter];
            return write ? { digest: structuredClone(write.digest), revision: write.expectedRevision } : undefined;
          },
          onPlan: async chapters => {
            const contentVersion = await getDigestContentVersion(step.bookId, combined);
            if (saved.graph && saved.graph.contentVersion !== contentVersion) throw new AppError("memory/conflict", "Graph source changed since checkpoint");
            await update(current => ({ ...current, graph: current.graph ?? { contentVersion, targets: chapters, completed: [], writes: {} } }));
          },
          saveDigest: async (bookId, digest, revision, writeSignal) => {
            assert();
            if (!saved.graph || saved.graph.contentVersion !== digest.contentVersion) throw new AppError("memory/conflict", "Graph checkpoint source changed");
            const write = saved.graph.writes[digest.chapterIndex] ?? await prepareDurableDigestWrite(bookId, digest, revision, writeSignal, actor);
            await update(current => ({ ...current, graph: { ...current.graph!, writes: { ...current.graph!.writes, [digest.chapterIndex]: write } } }));
            await commitDurableDigestWrite(write, writeSignal, actor);
            await update(current => { const graph = structuredClone(current.graph!); delete graph.writes[digest.chapterIndex];
              graph.completed = [...new Set([...graph.completed, digest.chapterIndex])]; return { ...current, graph }; });
          },
        });
        let taskId: string | undefined;
        try {
          const started = await owner.start(step.bookId, step.mode, step.options, combined, actor);
          taskId = started.taskId;
          await update(current => ({ ...current, taskId }));
          await owner.whenSettled(step.bookId, taskId);
          const terminal = await owner.get(step.bookId, taskId);
          await update(current => ({ ...current, taskId, terminal }));
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
          if (data.graph) {
            if (await getDigestContentVersion(step.bookId, signal) !== data.graph.contentVersion) return attention("memory/conflict", !!data.terminal);
            const next = structuredClone(data);
            for (const [index, write] of Object.entries(next.graph!.writes)) {
              if (await durableDigestReceipt(write)) {
                delete next.graph!.writes[index]; next.graph!.completed = [...new Set([...next.graph!.completed, Number(index)])];
              }
              assert();
            }
            // A known partial result requires explicit continuation. A crashed
            // pass uses its persisted targets and conditional generated writes.
            if (data.terminal && !explicitResume) return attention("jobs/step-incomplete", true);
            delete next.terminal;
            return { status: "ready" as const, data: next };
          }
          if (explicitResume && data.terminal) return { status: "ready" as const, data: { kind: step.kind, bookId: step.bookId } };
          return attention("jobs/outcome-unknown", !!data.terminal);
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
