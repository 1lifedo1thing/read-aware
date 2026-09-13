import { AppError, normalizeConversationTarget, normalizeConversationTurnRequest,
  type ConversationRuntimeSnapshot, type ConversationTarget, type EventOrigin } from "@read-aware/core";
import type { PluginConversationsDomain, PluginConversationRuntimeSnapshot, ConversationDomainEventType, PluginDomainEvent } from "@read-aware/plugin-types";
import type { ActorDomainView } from "../../../domain/registry";
import { pluginObjectAccessDenied, type CurrentBookSnapshot, type PluginBookAccessPolicy } from "../../../domain/plugin-object-access";
import { createLogger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";

type Reader = {
  current(): CurrentBookSnapshot;
  observe(handler: () => void): () => void;
};
const log = createLogger("scoped-conversations");

/** Book threads are keyed by the book, while global threads remain a distinct
 * authority. A pending proposal retains its book fence until the host adopts
 * or retires it; accepting it is still exclusively a host UI action. */
export function scopePluginConversations(domain: NonNullable<ActorDomainView["conversations"]>,
  policy: PluginBookAccessPolicy, lifecycle: PluginLifecycleController, reader: Reader,
  origin: EventOrigin): PluginConversationsDomain {
  const denied = (operation: string): never => { throw pluginObjectAccessDenied(`conversations.${operation}`); };
  const book = () => policy.grant.mode === "book" ? policy.grant.bookId : reader.current().bookId;
  const requireBook = () => book() ?? denied("current book");
  const target = (input: ConversationTarget) => {
    const value = normalizeConversationTarget(input);
    if (value.kind !== "book") return denied("global thread");
    policy.assertBook(value.id, "conversation target");
    return value;
  };
  async function run<T>(operation: string, bookId: string,
    work: (signal: AbortSignal, release: () => void) => Promise<T>, mode: "read" | "write" | "proposal" = "read") {
    lifecycle.assertActive(`conversations.${operation}`);
    const fence = await policy.beginBook(bookId, `conversations.${operation}`), cancel = new AbortController();
    const signal = AbortSignal.any([lifecycle.signal, cancel.signal, ...(fence.signal ? [fence.signal] : [])]);
    try {
      signal.throwIfAborted();
      const pending = mode === "read" ? lifecycle.read(`conversations.${operation}`, () => work(signal, fence.dispose), signal)
        : work(signal, fence.dispose);
      if (mode !== "read") lifecycle.trackCleanup(pending.then(() => {}, () => {}));
      const result = await pending;
      await fence.assertUnchanged({ retain: mode === "proposal" });
      return result;
    } catch (error) { cancel.abort(error); fence.dispose(); throw error; }
    finally { if (mode !== "proposal") fence.dispose(); }
  }

  let projectedKey: string | undefined, revision = 0;
  const project = (snapshot: Pick<ConversationRuntimeSnapshot, "sessions">): PluginConversationRuntimeSnapshot => {
    const bookId = book(), sessions = snapshot.sessions.filter(session => session.kind === "book" && session.id === bookId);
    const key = JSON.stringify([bookId, policy.grant.mode === "current" ? reader.current().sessionId : null, sessions]);
    if (key !== projectedKey) { projectedKey = key; revision++; }
    return { revision, selectedGlobalThreadId: null, sessions: structuredClone(sessions) };
  };
  const queries: PluginConversationsDomain["queries"] = {
    listThreads: () => denied("listThreads"), getThread: () => denied("getThread"),
    getInsights(input) {
      const value = target(input);
      return run("getInsights", value.id, () => domain.queries.getInsights(value));
    },
    getBookThread(bookId) {
      const value = target({ kind: "book", id: bookId });
      return run("getBookThread", value.id, () => domain.queries.getBookThread(value.id));
    },
    async turnRequests() {
      lifecycle.assertActive("conversations.turnRequests");
      const bookId = book(); if (bookId === null) return [];
      return run("turnRequests", bookId, async () => (await domain.queries.turnRequests())
        .filter(request => request.target.kind === "book" && request.target.id === bookId));
    },
    async runtime() {
      lifecycle.assertActive("conversations.runtime");
      const bookId = book();
      if (bookId === null) return project({ sessions: [] });
      return run("runtime", bookId, async () => project(await domain.queries.runtime()));
    },
  };
  const commands = domain.commands;
  return { queries, events: {
    subscribe(event, handler, options) {
      if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected a conversation event callback");
      return lifecycle.stage(() => ({ dispose: domain.events.subscribe<ConversationDomainEventType>(event, broadcast => {
        if (lifecycle.signal.aborted || options?.ignoreSelf && broadcast.origin === origin) return;
        try {
          target({ kind: "book", id: broadcast.payload.conversationId });
          if ("bookId" in broadcast.payload && broadcast.payload.bookId !== undefined && broadcast.payload.bookId !== broadcast.payload.conversationId) return;
        } catch { return; }
        // The shared subscription already matched the exact requested event.
        return handler(structuredClone(broadcast) as PluginDomainEvent<typeof event>);
      }) }));
    },
    observeRuntime(handler) {
      if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected a conversation runtime callback");
      return lifecycle.stage(() => {
        let stopped = false, seen = -1, latest: ConversationRuntimeSnapshot | undefined;
        const publish = () => {
          if (stopped || lifecycle.signal.aborted || !latest) return;
          const state = project(latest);
          if (seen === state.revision) return;
          seen = state.revision;
          return handler(state);
        };
        const offRuntime = domain.events.observeRuntime(snapshot => { latest = snapshot; return publish(); });
        const offReader = reader.observe(() => {
          try { Promise.resolve(publish()).catch(error => log.warn("Conversation scope observer failed", error)); }
          catch (error) { log.warn("Conversation scope observer failed", error); }
        });
        return { dispose: () => { stopped = true; offRuntime(); offReader(); } };
      });
    },
    // These hints contain no object, transcript or global thread identities.
    // Remote/restore invalidation asks the actor to rerun its authorized query.
    observeInvalidation: handler => {
      if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected a conversation invalidation callback");
      return lifecycle.stage(() => {
      let revision = 0;
      const publish = (source: import("@read-aware/core").ProjectionInvalidation["source"]) => handler({ revision: ++revision, source });
      const offDomain = domain.events.observeInvalidation(event => publish(event.source));
      const offReader = reader.observe(() => {
        try { Promise.resolve(publish("host")).catch(error => log.warn("Conversation invalidation failed", error)); }
        catch (error) { log.warn("Conversation invalidation failed", error); }
      });
      return { dispose: () => { offDomain(); offReader(); } };
      });
    },
  }, ...(commands ? { commands: {
    createThread: () => denied("createThread"), selectThread: () => denied("selectThread"),
    requestTurn(input) {
      const request = normalizeConversationTurnRequest(input), value = target(request.target);
      return run("requestTurn", value.id, (signal, release) => commands.requestTurn(request, signal, release), "proposal");
    },
    cancelTurnRequest(id) {
      return run("cancelTurnRequest", requireBook(), async signal => {
        const request = (await domain.queries.turnRequests()).find(request => request.id === id);
        signal.throwIfAborted();
        if (!request) throw new AppError("ui/invalid-target", "Conversation request does not exist for this actor");
        target(request.target);
        return commands.cancelTurnRequest(id, signal);
      }, "write");
    },
    stop(input) {
      const value = target(input);
      return run("stop", value.id, signal => commands.stop(value, signal), "write");
    },
    clear(input) {
      const value = target(input);
      return run("clear", value.id, signal => commands.clear(value, signal), "write");
    },
  } satisfies NonNullable<PluginConversationsDomain["commands"]> } : {}) };
}
