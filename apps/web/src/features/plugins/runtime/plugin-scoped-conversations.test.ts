import { expect, test } from "bun:test";
import type { ConversationRuntimeSnapshot, DomainEventType } from "@read-aware/core";
import type { PluginBookAccess, PluginConversationRuntimeSnapshot } from "@read-aware/plugin-types";
import { createConversationsDomain } from "../../../domain/conversations";
import { ConversationTurnRequests } from "../../../domain/conversation-turn-requests";
import { createPluginBookAccessPolicy, type CurrentBookSnapshot } from "../../../domain/plugin-object-access";
import { broadcastDomainEventDrafts, type DomainEventDraft } from "../../../platform/domain-events";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { scopePluginConversations } from "./plugin-scoped-conversations";
import { deferred } from "../../../../tests/helpers/entity-host";

function fixture(grant: PluginBookAccess = { mode: "current" }) {
  let current: CurrentBookSnapshot = { bookId: "a", sessionId: "a1" };
  const readers = new Set<() => void>(), runtimeListeners = new Set<(value: ConversationRuntimeSnapshot) => unknown>();
  const reader = { current: () => current, observe: (handler: () => void) => { readers.add(handler); return () => { readers.delete(handler); }; } };
  const policy = createPluginBookAccessPolicy(grant, async () => current,
    handler => reader.observe(() => handler(current)), () => current);
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const raw = createConversationsDomain("plugin:conversation-proof", lifecycle.signal);
  const snapshot: ConversationRuntimeSnapshot = { revision: 42, selectedGlobalThreadId: "thread-private", sessions: [
    ...["a", "b"].map(id => ({ kind: "book" as const, id, sessionId: id, loading: false, streaming: false, messageCount: 2 })),
    { kind: "global", id: "thread-private", sessionId: "global-session", loading: false, streaming: false, messageCount: 100 },
  ] };
  raw.queries.runtime = async () => snapshot;
  raw.events.observeRuntime = handler => { runtimeListeners.add(handler); handler(snapshot); return () => { runtimeListeners.delete(handler); }; };
  const requests = new ConversationTurnRequests(() => {}), sends: string[] = [];
  const unbind = ["a", "b"].map(id => requests.bind({ kind: "book", id }, {
    state: () => ({ loading: false, ready: true, generation: snapshot, canRetry: true }),
    draft: text => { sends.push(text); return true; }, send: text => { sends.push(text); return true; }, retry: () => true,
  }));
  raw.queries.turnRequests = async () => requests.list("plugin:conversation-proof");
  raw.commands.requestTurn = async (input, signal, release) => requests.request("plugin:conversation-proof", input, signal, release);
  raw.commands.cancelTurnRequest = async id => requests.cancel("plugin:conversation-proof", id);
  const api = scopePluginConversations(raw, policy, lifecycle, reader, "plugin:conversation-proof");
  return { api, raw, requests, sends, readers, snapshot, lifecycle,
    changed: async () => { for (const handler of [...runtimeListeners]) await handler(snapshot); },
    switchBook: (bookId: string | null, sessionId = `${bookId}1`) => {
      current = { bookId, sessionId }; for (const handler of [...readers]) handler();
    }, close: async () => { unbind.forEach(stop => stop()); lifecycle.stop(); await lifecycle.drainCleanups(); } };
}

test("fixed-book transcript and summaries work while another book is open, and global access remains explicit", async () => {
  const f = fixture({ mode: "book", bookId: "a" }); f.switchBook("b");
  const calls: string[] = [];
  f.raw.queries.getBookThread = async id => { calls.push(id); return [{ id: "message", role: "user", content: "Question", createdAt: "t" }]; };
  f.raw.queries.getInsights = async target => { calls.push(target.id); return "Summary"; };
  try {
    expect((await f.api.queries.getBookThread("a"))[0]?.content).toBe("Question");
    expect(await f.api.queries.getInsights({ kind: "book", id: "a" })).toBe("Summary");
    for (const action of [() => f.api.queries.getBookThread("b"), () => f.api.queries.getInsights({ kind: "global", id: "thread-private" }),
      () => f.api.queries.listThreads(), () => f.api.queries.getThread("thread-private"), () => f.api.commands!.createThread()]) {
      expect(action).toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
    }
    expect(calls).toEqual(["a", "a"]);
  } finally { await f.close(); }
});

test("current-book transcript reads reject after session replacement and still drain the host read", async () => {
  const f = fixture(), entered = deferred(), gate = deferred();
  f.raw.queries.getBookThread = async () => { entered.resolve(); await gate.promise; return []; };
  try {
    const pending = f.api.queries.getBookThread("a"); await entered.promise;
    f.switchBook("a", "a2"); await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    gate.resolve(); await f.lifecycle.drainCleanups(); expect(f.readers.size).toBe(0);
  } finally { gate.resolve(); await f.close(); }
});

test("runtime snapshots and revisions reveal only the authorized book, including reader closure", async () => {
  const f = fixture(), seen: PluginConversationRuntimeSnapshot[] = [];
  const subscription = f.api.events.observeRuntime(value => { seen.push(value); });
  try {
    expect(seen).toHaveLength(1); expect(seen[0]?.selectedGlobalThreadId).toBeNull();
    expect(seen[0]?.sessions.map(value => value.id)).toEqual(["a"]);
    const initial = await f.api.queries.runtime();
    f.snapshot.revision += 100; f.snapshot.selectedGlobalThreadId = "thread-another"; f.snapshot.sessions[2]!.messageCount++;
    await f.changed(); expect(seen).toHaveLength(1); expect((await f.api.queries.runtime()).revision).toBe(initial.revision);
    f.switchBook("b"); expect(seen.at(-1)?.sessions.map(value => value.id)).toEqual(["b"]);
    f.switchBook(null); expect(seen.at(-1)?.sessions).toEqual([]); expect((await f.api.queries.runtime()).selectedGlobalThreadId).toBeNull();
    subscription.dispose(); const count = seen.length; await f.changed(); expect(seen).toHaveLength(count);
  } finally { subscription.dispose(); await f.close(); }
});

test("pending proposals retain the original book fence; host acceptance releases it and is never automatic", async () => {
  const f = fixture();
  try {
    const input = { target: { kind: "book" as const, id: "a" }, action: "send" as const, text: "Allowed question" };
    const work = f.api.commands!.requestTurn(input); input.target.id = "b"; input.text = "Changed question";
    const request = await work; expect(request.status).toBe("pending"); expect(f.sends).toEqual([]); expect(f.readers.size).toBe(1);
    f.switchBook("b"); expect(f.requests.list("plugin:conversation-proof")[0]?.status).toBe("cancelled");
    expect(() => f.requests.accept(request.id)).toThrow(); expect(f.readers.size).toBe(0);
    f.switchBook("a");
    const accepted = await f.api.commands!.requestTurn({ target: { kind: "book", id: "a" }, action: "send", text: "Approved question" });
    expect(f.requests.accept(accepted.id).status).toBe("started"); expect(f.sends).toEqual(["Approved question"]); expect(f.readers.size).toBe(0);
    f.switchBook("b"); expect(f.requests.list("plugin:conversation-proof").at(-1)?.status).toBe("started");
    expect(await f.api.queries.turnRequests()).toEqual([]);
    await expect(f.api.commands!.cancelTurnRequest(accepted.id)).rejects.toMatchObject({ code: "plugin/object-access-denied" });
  } finally { await f.close(); }
});

test("canonical conversation events filter books and ignoreSelf before invoking the plugin", async () => {
  const f = fixture(), seen: DomainEventType[] = [];
  const subscription = f.api.events.subscribe("aiMessage.appended", event => { seen.push(event.type); }, { ignoreSelf: true });
  const append = (conversationId: string, origin: DomainEventDraft["origin"] = "user") => broadcastDomainEventDrafts([{
    type: "aiMessage.appended", origin, payload: { messageId: "m", conversationId, role: "user", seq: 0, content: "Message" },
  }]);
  try {
    append("thread-private"); append("b"); append("a", "plugin:conversation-proof"); expect(seen).toEqual([]);
    append("a"); expect(seen).toHaveLength(1);
    f.switchBook("b"); append("a"); expect(seen).toHaveLength(1); append("b"); expect(seen).toHaveLength(2);
  } finally { subscription.dispose(); await f.close(); }
});

test("stop and clear freeze the authorized target, and writes admitted before scope retirement are drained", async () => {
  const f = fixture(), entered = deferred(), gate = deferred(); let captured: unknown, signal: AbortSignal | undefined;
  f.raw.commands.clear = async (target, inputSignal) => { captured = target; signal = inputSignal; entered.resolve(); await gate.promise;
    return { status: "completed", target };
  };
  try {
    const target = { kind: "book" as const, id: "a" }; const pending = f.api.commands!.clear(target); target.id = "b";
    await entered.promise; expect(captured).toEqual({ kind: "book", id: "a" }); f.switchBook("b"); expect(signal?.aborted).toBe(true);
    let drained = false; const draining = f.lifecycle.drainCleanups().then(() => { drained = true; }); await Promise.resolve(); expect(drained).toBe(false);
    gate.resolve(); await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" }); await draining;
    expect(() => f.api.commands!.stop({ kind: "book", id: "a" })).toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
  } finally { gate.resolve(); await f.close(); }
});
