import { observeSnapshot } from "./snapshot-observation";
import { actorFromEvent, copyEventCause, causalActor, type DomainActor } from "../platform/domain-actor";
import { AppError, normalizeConversationTarget, type ConversationTarget, type ConversationRuntimeSnapshot } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { activeGlobalThreadSourceAtom, activeGlobalThreadAtom, selectGlobalThread } from "../features/ai/state/global-thread";
import { clearConversation, listGlobalThreads, newGlobalThreadId } from "../features/ai/lib/conversation-store";
import { getBookRecord } from "../features/library/lib/library-db";
import { emitAppEvent } from "../platform/app-events";
import { createLogger } from "../platform/logger";
import { ConversationRuntime } from "./conversation-runtime";
import { ConversationTurnRequests } from "./conversation-turn-requests";

const log = createLogger("conversation-control");
export const conversationRuntime = new ConversationRuntime(error => log.warn("Conversation lifecycle failed", error));
export const conversationTurnRequests = new ConversationTurnRequests(origin => conversationRuntime.changed(origin));
const store = getDefaultStore();
store.sub(activeGlobalThreadSourceAtom, () => conversationRuntime.changed(actorFromEvent(store.get(activeGlobalThreadSourceAtom))));
export function conversationSnapshot(): ConversationRuntimeSnapshot {
  return copyEventCause(conversationRuntime.provenance(), { revision: conversationRuntime.revision, selectedGlobalThreadId: store.get(activeGlobalThreadAtom), sessions: conversationRuntime.snapshot() });
}
let observers = 0;
export function observeConversations(handler: (value: ConversationRuntimeSnapshot, source: object) => unknown, origin: DomainActor = "system", lifetime?: AbortSignal) {
  lifetime?.throwIfAborted();
  if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected conversation observer");
  if (observers >= 64) throw new AppError("ui/observer-limit", "Too many conversation observers");
  observers++;
  let stopped = false, off: () => void;
  try { off = observeSnapshot(conversationSnapshot, notify => conversationRuntime.observe(notify), handler,
    error => log.warn("Conversation observer failed", error), origin); }
  catch (error) { observers--; throw error; }
  const stop = () => { if (stopped) return; stopped = true; observers--; off(); lifetime?.removeEventListener("abort", stop); };
  lifetime?.addEventListener("abort", stop, { once: true });
  if (lifetime?.aborted) stop();
  return stop;
}

export function conversationCommands(origin: DomainActor) {
  const validate = async (input: ConversationTarget, signal?: AbortSignal) => {
    const target = normalizeConversationTarget(input); signal?.throwIfAborted();
    if (target.kind === "book" && !await getBookRecord(target.id)) throw new AppError("library/book-not-found", "Conversation book does not exist");
    signal?.throwIfAborted(); return target;
  };
  return {
    requestTurn: async (input: import("@read-aware/core").ConversationTurnRequest, signal?: AbortSignal, onRetire?: () => void) =>
      conversationTurnRequests.request(origin, input, signal, onRetire),
    cancelTurnRequest: async (id: string, signal?: AbortSignal) => {
      signal?.throwIfAborted(); return conversationTurnRequests.cancel(origin, id);
    },
    createThread: async (signal?: AbortSignal) => {
      signal?.throwIfAborted(); const id = newGlobalThreadId();
      await selectGlobalThread(id, origin, signal);
      return { status: "completed" as const, target: { kind: "global" as const, id }, draft: true as const };
    },
    selectThread: async (threadId: string, signal?: AbortSignal) => {
      const target = normalizeConversationTarget({ kind: "global", id: threadId }); signal?.throwIfAborted();
      if (store.get(activeGlobalThreadAtom) !== target.id && !(await listGlobalThreads()).some(thread => thread.id === target.id)) {
        throw new AppError("ui/invalid-target", "Global conversation does not exist");
      }
      await selectGlobalThread(target.id, origin, signal);
      return { status: "completed" as const, target };
    },
    stop: async (input: ConversationTarget, signal?: AbortSignal) => {
      const source = causalActor(origin);
      const target = await validate(input, signal);
      conversationTurnRequests.cancelTarget(target.id, source);
      await conversationRuntime.quiesce(target.id, async () => {}, signal, source);
      return { status: "completed" as const, target };
    },
    clear: async (input: ConversationTarget, signal?: AbortSignal) => {
      const source = causalActor(origin);
      const target = await validate(input, signal);
      conversationTurnRequests.cancelTarget(target.id, source);
      await conversationRuntime.quiesce(target.id, async () => {
        // Lazy import avoids making the Agent's port construction import its own runtime.
        const { discardAgentThread } = await import("../features/ai/agent/agent-runtime");
        signal?.throwIfAborted();
        await discardAgentThread(target.kind, target.id, source);
        signal?.throwIfAborted();
        await clearConversation(target.id, source, signal);
        emitAppEvent("conversations-changed", {}, source);
      }, signal, source);
      return { status: "completed" as const, target };
    },
  };
}
