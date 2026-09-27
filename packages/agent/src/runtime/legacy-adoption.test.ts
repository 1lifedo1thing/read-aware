/**
 * 旧线程领养（存量用户的继承半场）：摘要/记忆管线上线前就积累了转录的
 * 线程，在第一轮新对话的轮后管道里被领养——历史尾部折叠成初始滚动摘要、
 * 同一窗口跑一次继承提炼。insights 行是领养的水位线：有了它门条件永不
 * 再成立。
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { messageText } from "../testing/message-text";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, type FauxProviderRegistration } from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps, TurnRecord } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
import { hostTurn } from "../testing/transcript-host";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOK: ThreadScope = { kind: "book", bookId: "b1" as Id };

/** 旧 agent 时代的历史转录（记忆管线上线之前）。 */
function legacyTurns(): TurnRecord[] {
  return [
    { role: "user", content: "我觉得叶文洁的动机是绝望而不是恶意。", createdAt: "2026-01-01T00:00:00Z" },
    { role: "assistant", content: "可以这么读：她的经历……", createdAt: "2026-01-01T00:01:00Z" },
    { role: "user", content: "我读书主要为了研究人物心理。", createdAt: "2026-01-02T00:00:00Z" },
    { role: "assistant", content: "明白，这本书很适合。", createdAt: "2026-01-02T00:01:00Z" },
  ];
}

describe("legacy thread adoption", () => {
  let faux: FauxProviderRegistration;

  function makeFaux(): Model<Api> {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    return faux.getModel() as Model<Api>;
  }

  afterEach(() => {
    faux?.unregister();
  });

  /** 按提示词区分三类 fast 调用：bootstrap 摘要 / 提炼 / 滚动摘要折叠。 */
  function trackingComplete(calls: Array<{ kind: string; content: string }>): CompleteFn {
    return async (_model, context) => {
      const system = String(context.systemPrompt ?? "");
      const content = messageText(context.messages[0]);
      if (system.includes("existed BEFORE the summary system")) {
        calls.push({ kind: "bootstrap", content });
        return fauxAssistantMessage("历史摘要：读者关注叶文洁的动机与人物心理。");
      }
      if (system.includes("long-term memory")) {
        calls.push({ kind: "extraction", content });
        return fauxAssistantMessage(
          content.includes("绝望而不是恶意")
            ? '{"new": [{"scope": "user", "kind": "preference", "content": "读者读书为研究人物心理"}], "reinforced": []}'
            : '{"new": [], "reinforced": []}',
        );
      }
      calls.push({ kind: "fold", content });
      return fauxAssistantMessage("最终摘要");
    };
  }

  function makeThread(deps: RuntimeDeps, model: Model<Api>, completeFn: CompleteFn) {
    return new AgentThread({
      scope: BOOK,
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn,
      streamFn: streamSimple,
    });
  }

  /** One chat turn with the host saving the transcript around it, as in the product. */
  async function drain(transcripts: Map<string, TurnRecord[]>, thread: AgentThread, text: string): Promise<void> {
    for await (const _ of hostTurn(transcripts, thread, { text })) {
      // drain
    }
  }

  test("a thread with history but no summary is adopted: bootstrap + inherited memories + folded summary", async () => {
    const model = makeFaux();
    faux.setResponses([fauxAssistantMessage("好的")]);
    const { deps, stores } = createInMemoryDeps({
      books: [{ id: "b1" as Id, title: "书", status: "reading", narrativity: "narrative", spoilerSensitive: true }],
      turns: { "book:b1": legacyTurns() },
    });
    const calls: Array<{ kind: string; content: string }> = [];
    const thread = makeThread(deps, model, trackingComplete(calls));

    await drain(stores.turns, thread, "接着聊。");
    await thread.flushBackgroundWork();

    const bootstrap = calls.find((call) => call.kind === "bootstrap");
    expect(bootstrap).toBeDefined();
    // 领养窗口是历史，不含本轮
    expect(bootstrap!.content).toContain("绝望而不是恶意");
    expect(bootstrap!.content).not.toContain("接着聊");
    // 继承提炼吃的是同一历史窗口
    const inherited = stores.savedMemoryInputs.find((input) => input.content === "读者读书为研究人物心理");
    expect(inherited).toMatchObject({ scope: "user", sourceThreadKey: "book:b1" });
    // 滚动摘要以 bootstrap 为 previous 折叠本轮
    const fold = calls.find((call) => call.kind === "fold");
    expect(fold!.content).toContain("历史摘要");
    expect(stores.insights.get("book:b1")).toBe("最终摘要");
  });

  test("insights are the adoption watermark: a second turn never bootstraps again", async () => {
    const model = makeFaux();
    faux.setResponses([fauxAssistantMessage("回一"), fauxAssistantMessage("回二")]);
    const { deps, stores } = createInMemoryDeps({
      books: [{ id: "b1" as Id, title: "书", status: "reading", narrativity: "narrative", spoilerSensitive: true }],
      turns: { "book:b1": legacyTurns() },
    });
    const calls: Array<{ kind: string; content: string }> = [];
    const thread = makeThread(deps, model, trackingComplete(calls));

    await drain(stores.turns, thread, "第一轮。");
    await thread.flushBackgroundWork();
    await drain(stores.turns, thread, "第二轮。");
    await thread.flushBackgroundWork();

    expect(calls.filter((call) => call.kind === "bootstrap")).toHaveLength(1);
  });

  test("a pre-summarized thread and a fresh thread both skip adoption", async () => {
    const model = makeFaux();
    faux.setResponses([fauxAssistantMessage("回一"), fauxAssistantMessage("回二")]);
    const { deps, stores } = createInMemoryDeps({
      books: [{ id: "b1" as Id, title: "书", status: "reading", narrativity: "narrative", spoilerSensitive: true }],
      turns: { "book:b1": legacyTurns() },
      insights: { "book:b1": "已有摘要" },
    });
    const calls: Array<{ kind: string; content: string }> = [];
    const thread = makeThread(deps, model, trackingComplete(calls));
    await drain(stores.turns, thread, "有摘要的旧线程。");
    await thread.flushBackgroundWork();
    expect(calls.filter((call) => call.kind === "bootstrap")).toHaveLength(0);

    const fresh = createInMemoryDeps({
      books: [{ id: "b1" as Id, title: "书", status: "reading", narrativity: "narrative", spoilerSensitive: true }],
    });
    const freshCalls: Array<{ kind: string; content: string }> = [];
    const freshThread = makeThread(fresh.deps, model, trackingComplete(freshCalls));
    await drain(fresh.stores.turns, freshThread, "全新线程。");
    await freshThread.flushBackgroundWork();
    expect(freshCalls.filter((call) => call.kind === "bootstrap")).toHaveLength(0);
  });

  // Production ordering: the chat host saves the user message and awaits it
  // before streaming, and saves the reply only after the stream ends. The
  // post-turn pipeline is scheduled inside the stream, so its transcript read
  // races the reply save. Adoption used to assume both rows were present and
  // sliced off the last two — when the pipeline won, that dropped the most
  // recent historical reply instead of this turn's.
  for (const replySavedFirst of [false, true]) {
    test(`adoption folds exactly the pre-turn history (${replySavedFirst ? "reply saved before" : "pipeline reads before"} the reply save)`, async () => {
      const model = makeFaux();
      faux.setResponses([fauxAssistantMessage("本轮回答")]);
      const { deps, stores } = createInMemoryDeps({
        books: [{ id: "b1" as Id, title: "书", status: "reading", narrativity: "narrative", spoilerSensitive: true }],
        turns: { "book:b1": legacyTurns() },
      });
      const calls: Array<{ kind: string; content: string }> = [];
      const thread = makeThread(deps, model, trackingComplete(calls));
      const transcript = stores.turns.get("book:b1")!;
      transcript.push({ id: "turn-1", role: "user", content: "接着聊。", createdAt: "2026-09-27T00:00:00Z" });
      for await (const _ of thread.sendTurn({ text: "接着聊。", turnId: "turn-1" })) {
        // stream
      }
      const saveReply = () =>
        transcript.push({ id: "reply-1", role: "assistant", content: "本轮回答", createdAt: "2026-09-27T00:00:05Z" });
      if (replySavedFirst) saveReply();
      await thread.flushBackgroundWork();
      if (!replySavedFirst) saveReply();

      const bootstrap = calls.find((call) => call.kind === "bootstrap");
      expect(bootstrap).toBeDefined();
      expect(bootstrap!.content).toContain("我读书主要为了研究人物心理");
      expect(bootstrap!.content).toContain("明白，这本书很适合。");
      expect(bootstrap!.content).not.toContain("接着聊");
      expect(bootstrap!.content).not.toContain("本轮回答");
    });
  }
});
