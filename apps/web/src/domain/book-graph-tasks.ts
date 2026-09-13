import { classifyBookIfUnclassified } from "./book-classification";
import type { DomainActor } from "../platform/domain-actor";
import { createBookMemoryPort } from "../features/ai/agent/ports/book-memory-port";
import { BookGraphTaskOwner } from "@read-aware/agent";
import { AppError } from "@read-aware/core";
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

export function createBookGraphTasks(lifetime?: AbortSignal, trackCleanup?: (work: Promise<void>) => void) {
  const owner = new BookGraphTaskOwner<DomainActor>(async (input, actor) => {
    // Lazy runtime access avoids constructing a second Agent or a registry import cycle.
    const { getAgentRuntime } = await import("../features/ai/agent/agent-runtime");
    input.signal.throwIfAborted();
    const runtime = getAgentRuntime();
    if (!runtime) throw new AppError("ai/not-configured", "Graph tasks require a configured model");
    return runtime.runBookGraphTask({ ...input, bookMemory: createBookMemoryPort(actor),
      classifyBookIfUnclassified: (bookId, flavor, signal) => classifyBookIfUnclassified(bookId, flavor, signal, actor),
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
