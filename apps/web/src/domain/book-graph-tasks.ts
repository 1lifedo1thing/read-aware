import { classifyBookIfUnclassified } from "./book-classification";
import type { DomainActor } from "../platform/domain-actor";
import { createBookMemoryPort } from "../features/ai/agent/ports/book-memory-port";
import { createBookTextPort } from "../features/ai/agent/ports/book-text-port";
import { BookGraphTaskOwner, type BookMemoryPort } from "@read-aware/agent";
import { AppError, assertOperationConditions, type OperationCondition } from "@read-aware/core";
import { getBookRecord } from "../features/library/lib/library-db";
import { getPersistedBookText } from "../features/library/lib/book-text-store";
import { readingRuntime } from "./reading-runtime";
import { bookMemoryBoundary } from "./book-memory-boundary";
import { createLogger } from "../platform/logger";

const log = createLogger("book-graph-tasks");
async function resolveBoundary(bookId: string): Promise<number | undefined> {
  const book = await getBookRecord(bookId);
  if (!book) throw new AppError("reader/book-not-found", "Graph task book disappeared");
  const chapters = await getPersistedBookText(bookId);
  const boundary = bookMemoryBoundary(book, readingRuntime.snapshot(), chapters?.map((chapter, index) => ({ index, hrefs: chapter.hrefs })) ?? null);
  return boundary.kind === "all" ? chapters?.length : boundary.kind === "before" ? boundary.chapterIndex : undefined;
}

/** The same persisted chapter boundary used by execution. This does not start
 * extraction or classification, nor call a model or a content provider. */
export async function graphObjectConditions(bookId: string, signal?: AbortSignal): Promise<OperationCondition[]> {
  signal?.throwIfAborted();
  const boundary = await resolveBoundary(bookId);
  signal?.throwIfAborted();
  return [{ kind: "object", state: "satisfied", reason: "book-found" },
    { kind: "input", state: boundary === undefined ? "unavailable" : "satisfied",
      reason: boundary === undefined ? "graph-boundary-unavailable" : "graph-boundary-resolved",
      ...(boundary === undefined ? { errorCode: "memory/unavailable" } : {}) }];
}

export type DurableGraphExecution = {
  targets?: number[];
  preparedDigest?: import("@read-aware/agent").BookGraphTaskExecution["preparedDigest"];
  onPlan(chapters: number[]): Promise<void>;
  saveDigest: BookMemoryPort["saveDigest"];
};
export function createBookGraphTasks(lifetime?: AbortSignal, trackCleanup?: (work: Promise<void>) => void, durable?: DurableGraphExecution) {
  const owner = new BookGraphTaskOwner<DomainActor>(async (input, actor) => {
    // Lazy runtime access avoids constructing a second Agent or a registry import cycle.
    const { getAgentRuntime } = await import("../features/ai/agent/agent-runtime");
    input.signal.throwIfAborted();
    const { checkOperationAvailability } = await import("../services/operation-availability");
    // Capacity was reserved at admission; this dispatch rechecks source/model,
    // not the capacity already occupied by this task.
    const availability = await checkOperationAvailability({ operation: "memory.graph.generate", bookId: input.bookId,
      mode: input.rebuild ? "rebuild" : "catch-up", maxChapters: input.maxChapters }, input.signal);
    assertOperationConditions(availability.conditions.filter(condition => condition.kind !== "capacity"));
    input.signal.throwIfAborted();
    const runtime = getAgentRuntime();
    if (!runtime) throw new AppError("ai/not-configured", "Graph tasks require a configured model");
    const memory = createBookMemoryPort(actor);
    return runtime.runBookGraphTask({ ...input,
      ...(durable ? { targets: durable.targets, preparedDigest: durable.preparedDigest, onPlan: async (chapters: number[]) => {
        const boundary = await resolveBoundary(input.bookId);
        if (durable.targets?.some(index => boundary === undefined || index >= boundary)) throw new AppError("memory/conflict", "Saved graph plan exceeds the current reading boundary");
        await durable.onPlan(chapters); await input.onPlan(chapters);
      } } : {}),
      bookMemory: durable ? { ...memory, saveDigest: durable.saveDigest } : memory, bookText: createBookTextPort(actor),
      classifyBookIfUnclassified: (bookId, flavor, signal, spoilerSensitive) => classifyBookIfUnclassified(bookId, flavor, signal, spoilerSensitive, actor),
      resolveBoundary: () => resolveBoundary(input.bookId) });
  }, (message, error) => log.warn(message, error), lifetime);
  // The owner's abort listener runs first, cancelling admission and execution.
  // Its task receipt may already have left the RPC bridge, so drain it here.
  if (lifetime && !lifetime.aborted && trackCleanup) {
    lifetime.addEventListener("abort", () => trackCleanup(owner.drain()), { once: true });
  }
  return owner;
}

/** Agent handles survive model configuration changes, not an app restart. */
export const agentBookGraphTasks = createBookGraphTasks();
