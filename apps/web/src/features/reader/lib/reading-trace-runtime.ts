import { accrueReadingSession, noteReadingPosition, listPendingReadingSessions, flushReadingSessions, closeReadingSessionsForBackup } from "../../../platform/reading-session";
import { createLogger } from "../../../platform/logger";
import { ReadingTraceCoordinator } from "./reading-trace";

const log = createLogger("reading-session");
export const readingTraces = new ReadingTraceCoordinator({
  accrue: accrueReadingSession,
  position: noteReadingPosition,
  pending: listPendingReadingSessions,
  flush: flushReadingSessions,
  report: error => log.error("reading trace persistence failed; close must not claim durability", error),
});

/** Close portable facts on their owning device and keep this reader's later
 * observations behind the backup until all its physical work has finished. */
export function withReadingBackup<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return readingTraces.withWritesPaused(async () => {
    await closeReadingSessionsForBackup();
    signal?.throwIfAborted();
    return operation();
  }, signal);
}
