import { afterEach, expect, spyOn, test } from "bun:test";
import * as environment from "../../../platform/environment";
import * as events from "../../../platform/domain-events";
import * as ipc from "../../../platform/ipc";
import { saveConversation } from "./conversation-store";
import type { ChatMessage } from "./chat-types";

type Call = { command: string; args: any };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function host(commit: (args: any) => Promise<unknown> = async args => ({ appended: args.events.length, applied: args.events.length })) {
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const calls: Call[] = [], observed: string[] = [];
  const invoke = spyOn(ipc, "invoke").mockImplementation((async (command: string, args: any) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === "local_device_get") return { deviceId: "save-proof", lastHlcWallMs: null, lastHlcCounter: null };
    if (command === "ai_chat_load") return [];
    if (command === "ai_chat_commit") return commit(args);
    throw new Error(`unexpected command ${command}`);
  }) as typeof ipc.invoke);
  const off = events.onDomainEventBroadcast(event => {
    observed.push(event.type === "aiMessage.appended" ? `${event.type}:${event.payload.messageId}` : event.type);
  });
  cleanups.push(() => { off(); invoke.mockRestore(); native.mockRestore(); });
  return { calls, observed, commits: () => calls.filter(call => call.command === "ai_chat_commit") };
}

const user: ChatMessage = { id: "u1", role: "user", content: "Why?", createdAt: "2026-09-27T00:00:00Z",
  attachments: [{ kind: "selection", text: "passage", cfiRange: "epubcfi(/6/2)", chapterHref: "ch1" }] };
const answer: ChatMessage = { id: "a1", role: "assistant", content: "Because.", createdAt: "2026-09-27T00:00:01Z",
  parts: [{ type: "text", text: "Because." }] };
const failed: ChatMessage = { id: "e1", role: "assistant", content: "", createdAt: "2026-09-27T00:00:02Z", error: "network reset" };

test("a save is one native call: facts ride only in events, presentation carries only local columns", async () => {
  const h = host();
  await saveConversation("thread-save-one", [user, answer, failed]);
  expect(h.calls.map(call => call.command)).toEqual(["ai_chat_load", "local_device_get", "ai_chat_commit"]);
  const [{ args }] = h.commits();
  expect(args.conversationId).toBe("thread-save-one");
  expect(args.events.map((event: any) => [event.type, event.payload.messageId ?? null])).toEqual([
    ["aiConversation.started", null], ["aiMessage.appended", "u1"], ["aiMessage.appended", "a1"],
  ]);
  expect(args.events[1].payload).toMatchObject({ role: "user", seq: 0, content: "Why?" });
  // Event-backed rows: display order and rendered parts only — no role, content, time or attachments.
  expect(args.presentation).toEqual([
    { id: "u1", seq: 0 },
    { id: "a1", seq: 1, partsJson: JSON.stringify(answer.parts) },
  ]);
  // The failed turn has no event; it travels whole as a device-local stub.
  expect(args.errorStubs).toEqual([
    { id: "e1", conversationId: "thread-save-one", role: "assistant", seq: 2, content: "", createdAt: failed.createdAt, error: "network reset" },
  ]);
  expect(h.observed).toEqual(["aiConversation.started", "aiMessage.appended:u1", "aiMessage.appended:a1"]);
});

test("a rejected save broadcasts nothing and keeps its facts pending for the next save", async () => {
  let reject = true;
  const h = host(async args => {
    if (reject) throw { code: "db/locked", message: "synthetic commit failure" };
    return { appended: args.events.length, applied: args.events.length };
  });
  await expect(saveConversation("thread-save-two", [user])).rejects.toMatchObject({ code: "db/locked" });
  expect(h.observed).toEqual([]);
  reject = false;
  await saveConversation("thread-save-two", [user, answer]);
  // The baseline did not advance past the failed write: the user's turn is re-sent with the reply.
  expect(h.commits()[1]!.args.events.map((event: any) => event.payload.messageId ?? event.type))
    .toEqual(["aiConversation.started", "u1", "a1"]);
  expect(h.observed).toEqual(["aiConversation.started", "aiMessage.appended:u1", "aiMessage.appended:a1"]);
});

test("a presentation-only save still commits through the same native transaction without events", async () => {
  const h = host();
  await saveConversation("thread-save-three", [user, answer, failed]);
  h.observed.length = 0;
  const rerendered: ChatMessage = { ...answer, parts: [{ type: "text", text: "Because, rendered." }] };
  await saveConversation("thread-save-three", [user, rerendered]);
  const last = h.commits().at(-1)!.args;
  expect(last.events).toEqual([]);
  expect(last.presentation).toEqual([{ id: "u1", seq: 0 }, { id: "a1", seq: 1, partsJson: JSON.stringify(rerendered.parts) }]);
  expect(last.errorStubs).toEqual([]);
  expect(h.observed).toEqual([]);
});
