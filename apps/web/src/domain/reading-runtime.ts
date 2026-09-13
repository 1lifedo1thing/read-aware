import { onAppEvent } from "../platform/app-events";
import { createLogger } from "../platform/logger";
import { ReadingSessionController } from "./reading-session-controller";
import { actorFromEvent } from "../platform/domain-actor";

const log = createLogger("reader");
export const readingRuntime = new ReadingSessionController(error => log.warn("reading observer failed", error));

onAppEvent("reader-demand-activity", event => readingRuntime.readerDemandActivity(event.sessionId, event.reason, actorFromEvent(event)));
