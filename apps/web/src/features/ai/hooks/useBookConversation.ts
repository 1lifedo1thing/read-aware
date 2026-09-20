import { getDefaultStore } from "jotai";
import { actorFromEvent, causalActor, mergeEventCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { readingRuntime } from "../../../domain/reading-runtime";
import { activeGlobalThreadSourceAtom } from "../state/global-thread";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorCode } from "@read-aware/core";
import { useTranslation } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { createLogger } from "../../../platform/logger";
import { conversationCommands, conversationRuntime } from "../../../domain/conversation-control";
import { appendStreamChunk, finalizeParts, partsText } from "../lib/chat-stream";
import { getChatTransport } from "../lib/chat-transport";
import type {
  ChatAssistantPart,
  ChatAttachment,
  ChatMessage,
  ChatReadingCursor,
} from "../lib/chat-types";
import {
  loadConversation,
  saveConversation,
} from "../lib/conversation-store";

function useConversationValue<T>(initial: T, id: string) {
  const [state, setState] = useState(() => stampEventCause({ value: initial, id }, "system"));
  const set = useCallback((value: T, source: DomainActor) => setState(stampEventCause({ value, id }, source)), [id]);
  return [state.value, set, state] as const;
}

export interface BookConversation {
  messages: ChatMessage[];
  /** Initial load of the persisted conversation. */
  isLoading: boolean;
  isStreaming: boolean;
  /** The assistant turn assembled so far — prose, thinking and tool steps in order. */
  streamingParts: ChatAssistantPart[];
  /** Human-readable progress from the transport (e.g. "Thinking…"). */
  status: string | null;
  send: (text: string, attachments?: ChatAttachment[]) => boolean;
  /**
   * Retry a failed model step from the runtime checkpoint; successful replies
   * regenerate from scratch. No-op while streaming or on an empty transcript.
   */
  retry: () => boolean;
  stop: () => void;
  clear: () => Promise<void>;
}

/**
 * Owns the per-book conversation: loads it from the store, sends a turn through
 * the response seam, streams the reply, and persists each committed turn. The
 * components stay pure — all the async orchestration lives here.
 *
 * Failures live on the message, not the conversation: a failed turn commits an
 * assistant message carrying `error` (possibly with a partial reply), and the
 * transcript renders the inline error row + retry on it.
 */
const log = createLogger("ai");

export function useBookConversation(
  bookId: string,
  bookTitle: string,
  thread: "book" | "global" = "book",
  /** Live reader viewport sampled at send time; book thread only. */
  readingCursor: ChatReadingCursor | null = null,
): BookConversation {
  const { t } = useTranslation("ai");
  const [messages, setMessages, messagesSource] = useConversationValue<ChatMessage[]>([], bookId);
  const [isLoading, setIsLoading, loadingSource] = useConversationValue(true, bookId);
  const [isStreaming, setIsStreaming, streamingSource] = useConversationValue(false, bookId);
  const [streamingParts, setStreamingParts] = useState<ChatAssistantPart[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Latest committed messages, reachable synchronously inside the async turn.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Turn-in-flight marker + deferred sync reload; refs because the stream
  // callbacks and the app-event handler both need the value synchronously.
  const inFlightRef = useRef(false);
  const pendingReloadRef = useRef<object | null>(null);
  const reloadRevision = useRef(0);
  const stopRef = useRef<((source: DomainActor) => void) | null>(null);
  // Which conversation the hook is currently mounted on — a reload resolving
  // after the user switched books must not paint the old transcript.
  const mountedIdRef = useRef(bookId);
  mountedIdRef.current = bookId;
  // Sampled at send time via a ref so `send` stays stable across page turns.
  const readingCursorRef = useRef<ChatReadingCursor | null>(readingCursor);
  readingCursorRef.current = readingCursor;
  const bindingRef = useRef<ReturnType<typeof conversationRuntime.bind> | null>(null);
  const openingSource = useRef<DomainActor>("system");
  const published = useRef<{ messages: typeof messagesSource; loading: typeof loadingSource; streaming: typeof streamingSource } | null>(null);
  useEffect(() => {
    const source = thread === "global" ? getDefaultStore().get(activeGlobalThreadSourceAtom) : readingRuntime.snapshot();
    openingSource.current = ("id" in source ? source.id : source.bookId) === bookId ? actorFromEvent(source) : causalActor("system");
    const binding = conversationRuntime.bind({ kind: thread, id: bookId }, openingSource.current);
    published.current = null;
    bindingRef.current = binding;
    return () => { binding.dispose(); if (bindingRef.current === binding) bindingRef.current = null; };
  }, [bookId, thread]);
  useEffect(() => {
    if ([messagesSource, loadingSource, streamingSource].some(value => value.id !== bookId)) return;
    const previous = published.current;
    const sources = [
      ...(!previous || previous.messages.value.length !== messages.length ? [messagesSource] : []),
      ...(!previous || previous.loading.value !== isLoading ? [loadingSource] : []),
      ...(!previous || previous.streaming.value !== isStreaming ? [streamingSource] : []),
    ];
    if (sources.length) bindingRef.current?.update({ loading: isLoading, streaming: isStreaming, messageCount: messages.length }, actorFromEvent(mergeEventCauses(sources, {})));
    published.current = { messages: messagesSource, loading: loadingSource, streaming: streamingSource };
  }, [bookId, thread, isLoading, isStreaming, messages.length, messagesSource, loadingSource, streamingSource]);

  // (Re)load the persisted conversation when the book changes; abort any
  // in-flight turn from the previous book.
  useEffect(() => {
    let alive = true;
    const source = openingSource.current;
    reloadRevision.current++; pendingReloadRef.current = null;
    setMessages([], source); setIsStreaming(false, source);
    setIsLoading(true, source);
    void loadConversation(bookId).then((loaded) => {
      if (!alive) return;
      setMessages(loaded, source);
      setIsLoading(false, source);
    }).catch(error => {
      if (alive) log.warn("Conversation load failed", error);
    });
    return () => {
      alive = false;
      stopRef.current?.(causalActor("system"));
    };
  }, [bookId, thread, setMessages, setIsLoading, setIsStreaming]);

  /**
   * Re-read the persisted transcript (a sync pull may have merged peer
   * messages underneath this conversation; loading also re-baselines the
   * store's event diff). Skipped while a turn is in flight — swapping the
   * transcript under a streaming reply would race its final persist — and
   * re-checked when the load resolves, since a turn may have started meanwhile.
   */
  const reloadFromStore = useCallback((origin: DomainActor) => {
    const source = actorFromEvent(mergeEventCauses([...(pendingReloadRef.current ? [pendingReloadRef.current] : []), stampEventCause({}, origin)], {}));
    pendingReloadRef.current = stampEventCause({}, source);
    const revision = ++reloadRevision.current;
    if (inFlightRef.current) return;
    const id = mountedIdRef.current, owner = bindingRef.current;
    void loadConversation(id).then((loaded) => {
      if (mountedIdRef.current !== id || bindingRef.current !== owner || revision !== reloadRevision.current) return;
      if (inFlightRef.current) return;
      pendingReloadRef.current = null;
      setMessages(loaded, source);
    }).catch(error => log.warn("Conversation refresh failed", error));
  }, [setMessages]);

  const reloadRef = useRef(reloadFromStore);
  reloadRef.current = reloadFromStore;
  useEffect(() => onAppEvent("conversations-changed", event => reloadFromStore(actorFromEvent(event))), [reloadFromStore]);

  const persist = useCallback(
    (next: ChatMessage[], source: DomainActor, owner = bindingRef.current) => {
      if (mountedIdRef.current === bookId && bindingRef.current === owner) setMessages(next, source);
      return saveConversation(bookId, next, source);
    },
    [bookId, setMessages],
  );

  /**
   * The shared turn body: persist the user turn, stream the reply, commit the
   * assistant message. Regeneration rebuilds from the persisted transcript;
   * failure retry replays completed presentation and resumes the model step.
   */
  const runTurn = useCallback(
    (history: ChatMessage[], userMessage: ChatMessage, mode?: "retry" | "regenerate") => {
      const source = causalActor("user"), owner = bindingRef.current;
      let completionSource = source;
      const withUser = [...history, userMessage];
      inFlightRef.current = true;
      const persisted = persist(withUser, source, owner);

      setStreamingParts([]);
      setStatus(null);
      setIsStreaming(true, source);

      const controller = new AbortController();
      abortRef.current = controller;
      const stop = (origin: DomainActor) => {
        if (controller.signal.aborted) return;
        completionSource = actorFromEvent(mergeEventCauses([stampEventCause({}, source), stampEventCause({}, causalActor(origin))], {}));
        controller.abort();
      };
      stopRef.current = stop;

      const work = (async () => {
        let assembled: ChatAssistantPart[] = [];
        let failure: string | null = null;
        let failureCode: string | undefined;
        try {
          // The truncated transcript must be on disk before the agent
          // rehydrates from it (load-bearing for retry on the global thread).
          await persisted;
          controller.signal.throwIfAborted();
          const stream = getChatTransport().sendTurn(
            {
              bookId,
              bookTitle,
              history,
              message: userMessage,
              thread,
              readingCursor: readingCursorRef.current,
              reset: mode === "regenerate",
              retry: mode === "retry",
            },
            controller.signal,
          );
          for await (const chunk of stream) {
            if (controller.signal.aborted) break;
            if (chunk.type === "status") {
              setStatus(chunk.status);
            } else {
              assembled = appendStreamChunk(assembled, chunk);
              setStreamingParts(assembled);
            }
          }
        } catch (err) {
          const aborted =
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === "AbortError");
          if (!aborted) {
            // Raw detail goes to the log and (as diagnostics context) into the
            // message's `error` column; the UI renders localized copy from the
            // stable `errorCode` instead of ever showing the raw text.
            log.error("chat turn failed", err);
            failure =
              err instanceof Error && err.message ? err.message : t("chat.error.generic");
            failureCode = errorCode(err);
          }
        } finally {
          // Commit whatever was produced — even a partial reply after a stop —
          // so the conversation stays a faithful record. Reference parts
          // contribute nothing to `content`, so a cards-only reply must still
          // persist; a failure with no output persists an error-only stub so
          // the retry affordance has a message to live on.
          const parts = finalizeParts(assembled);
          const content = partsText(parts);
          const hasStructuredOutput = parts.some(
            (part) => part.type === "reference" || part.type === "interaction",
          );
          let committed: Promise<void> = Promise.resolve();
          if (content || hasStructuredOutput || failure) {
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content,
              createdAt: new Date().toISOString(),
              parts: parts.length > 0 ? parts : undefined,
              error: failure ?? undefined,
              errorCode: failure ? failureCode : undefined,
            };
            committed = persist([...withUser, assistantMessage], completionSource, owner);
          }
          if (abortRef.current === controller) {
            if (bindingRef.current === owner) {
              setStreamingParts([]);
              setStatus(null);
              setIsStreaming(false, completionSource);
            }
            stopRef.current = null;
            abortRef.current = null;
            inFlightRef.current = false;
          }
          // A sync pull landed mid-turn: reload now that the turn's own
          // persist has the transcript on disk.
          if (pendingReloadRef.current) {
            const deferredSource = actorFromEvent(pendingReloadRef.current);
            pendingReloadRef.current = null;
            void committed.then(() => reloadRef.current(deferredSource)).catch(error => log.warn("Deferred conversation reload failed", error));
          }
          await committed;
        }
      })();
      conversationRuntime.track(bookId, stop, work);
    },
    [bookId, bookTitle, thread, persist, reloadFromStore, setIsStreaming, t],
  );

  const send = useCallback(
    (text: string, attachments?: ChatAttachment[]) => {
      const trimmed = text.trim();
      const hasAttachment = !!attachments && attachments.length > 0;
      if ((!trimmed && !hasAttachment) || isLoading || inFlightRef.current || !conversationRuntime.canStart(bookId)) return false;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
        attachments: hasAttachment ? attachments : undefined,
      };
      runTurn(messagesRef.current, userMessage);
      return true;
    },
    [bookId, isLoading, runTurn],
  );

  const retry = useCallback(() => {
    if (isLoading || inFlightRef.current || !conversationRuntime.canStart(bookId)) return false;
    const current = messagesRef.current;
    let lastUserIndex = -1;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex < 0) return false;
    // Same user message object — id, attachments and timestamp preserved.
    const failed = current.slice(lastUserIndex + 1).some(message => message.role === "assistant" && message.error);
    runTurn(current.slice(0, lastUserIndex), current[lastUserIndex], failed ? "retry" : "regenerate");
    return true;
  }, [bookId, isLoading, runTurn]);

  const stop = useCallback(() => {
    stopRef.current?.(causalActor("user"));
  }, []);

  const clear = useCallback(async () => {
    const source = causalActor("user"), owner = bindingRef.current;
    await conversationCommands(source).clear({ kind: thread, id: bookId });
    if (mountedIdRef.current === bookId && bindingRef.current === owner) setMessages([], source);
  }, [bookId, thread, setMessages]);

  return { messages, isLoading, isStreaming, streamingParts, status, send, retry, stop, clear };
}
