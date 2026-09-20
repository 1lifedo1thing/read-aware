import { describe, expect, test } from "bun:test";
import { AgentEvalJudge, digestObservation, withJudge } from "./judge";
import { defineAgentEvalScenario } from "./agent-harness";
import type { AgentEvalObservation } from "./types";

const RUBRIC = ["States time in human units", "No raw counters"];

function observation(answer: string): unknown {
  return {
    answer,
    thinking: "",
    turns: [{ turn: 1, input: { text: "How long did I read?" }, answer, thinking: "", chunks: [] }],
    tools: [{ turn: 1, id: "t1", name: "get_reading_stats", args: { allBooks: true } }],
    interactions: [],
    modelRequests: [],
    telemetry: { wallTimeMs: 1 },
  };
}

function verdictJson(scores: number[]): string {
  return JSON.stringify({
    criteria: scores.map((score, index) => ({
      criterion: RUBRIC[index],
      score,
      rationale: `criterion ${index}`,
    })),
  });
}

describe("digestObservation", () => {
  test("extracts turns, answer, reader context and complete tool args from loose JSON", () => {
    const digest = digestObservation(observation("About 1h 30m."));
    expect(digest.userTurns).toEqual(["How long did I read?"]);
    expect(digest.turns).toEqual([
      { user: "How long did I read?", input: { text: "How long did I read?" }, assistant: "About 1h 30m." },
    ]);
    expect(digest.answer).toBe("About 1h 30m.");
    expect(digest.tools).toEqual([
      { name: "get_reading_stats", turn: 1, args: '{"allBooks":true}' },
    ]);
  });

  test("tolerates malformed observations", () => {
    expect(digestObservation(null)).toEqual({
      userTurns: [],
      turns: [],
      answer: "",
      tools: [],
      interactions: [],
    });
    expect(digestObservation({ answer: 42, turns: "x", tools: [{}] })).toEqual({
      userTurns: [],
      turns: [],
      answer: "",
      tools: [],
      interactions: [],
    });
  });

  test("gives the judge reader choices, cancellations and actual receipts without model internals", async () => {
    let prompt = "";
    const judge = new AgentEvalJudge({ complete: async value => { prompt = value; return verdictJson([1, 1]); } });
    await judge.assess({ description: "Clarify then update", rubric: RUBRIC, observation: {
      answer: "Updated globally.",
      turns: [{ input: { text: "Ask me which scope first." }, answer: "Updated globally." }],
      tools: [
        { turn: 1, name: "ask_user", output: '{"answered":true,"answer":"Globally"}', isError: false },
        { turn: 1, name: "update_settings", output: '{"updated":true}', isError: false },
        { turn: 2, name: "delete_book", output: '{"deleted":false,"reason":"User declined."}', isError: false },
        { turn: 2, name: "read_chapter", output: "unavailable", isError: true },
      ],
      interactions: [
        { turn: 1, phase: "response", kind: "question", value: { optionId: "global", text: "Globally" } },
        { turn: 2, phase: "response", kind: "question", value: { cancelled: true } },
      ],
      thinking: "PRIVATE_THINKING", modelRequests: [{ secret: "PRIVATE_REQUEST" }],
    } });
    expect(prompt).toContain('"answer":"Globally"');
    expect(prompt).toContain('"optionId":"global"');
    expect(prompt).toContain('"cancelled":true');
    expect(prompt).toContain('"deleted":false');
    expect(prompt).toContain("read_chapter [failed]");
    expect(prompt).not.toContain("PRIVATE_");
    const digest = digestObservation({ tools: [{ name: "read", output: "a".repeat(20_000) }],
      interactions: [{ phase: "response", value: { text: "b".repeat(20_000) } }, null, { phase: "unknown" }] });
    expect(digest.tools[0]?.output).toBe("a".repeat(20_000));
    expect(digest.interactions).toHaveLength(1);
    expect(digest.interactions[0]?.value).toContain("b".repeat(20_000));
  });
});

describe("AgentEvalJudge", () => {
  test("maps verdicts to quality checks with the pass threshold", async () => {
    const prompts: string[] = [];
    const judge = new AgentEvalJudge({
      complete: async (prompt) => {
        prompts.push(prompt);
        return verdictJson([0.9, 0.4]);
      },
    });
    const assessment = await judge.assess({
      description: "Humane stats",
      rubric: RUBRIC,
      observation: observation("About 1h 30m."),
    });
    expect(assessment.passed).toBe(false);
    expect(assessment.score).toBe(0.5);
    expect(assessment.checks).toEqual([
      expect.objectContaining({
        id: "quality.judge.0",
        category: "quality",
        passed: true,
        expected: RUBRIC[0],
        actual: 0.9,
      }),
      expect.objectContaining({ id: "quality.judge.1", passed: false, actual: 0.4 }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Humane stats");
    expect(prompts[0]).toContain("get_reading_stats");
    expect(prompts[0]).toContain("Turn 1 assistant");
  });

  test("retries once on malformed output, then fails loudly", async () => {
    let calls = 0;
    const flaky = new AgentEvalJudge({
      complete: async () => {
        calls += 1;
        return calls === 1 ? "not json" : `\`\`\`json\n${verdictJson([1, 1])}\n\`\`\``;
      },
    });
    const assessment = await flaky.assess({
      description: "d",
      rubric: RUBRIC,
      observation: observation("ok"),
    });
    expect(assessment.passed).toBe(true);
    expect(calls).toBe(2);

    const broken = new AgentEvalJudge({ complete: async () => "still not json" });
    await expect(
      broken.assess({ description: "d", rubric: RUBRIC, observation: observation("ok") }),
    ).rejects.toThrow("parseable verdict");
  });

  test("rejects verdicts whose criteria count mismatches the rubric", async () => {
    const judge = new AgentEvalJudge({ complete: async () => verdictJson([1]) });
    await expect(
      judge.assess({ description: "d", rubric: RUBRIC, observation: observation("ok") }),
    ).rejects.toThrow("parseable verdict");
  });
});

describe("withJudge", () => {
  const base = defineAgentEvalScenario({
    id: "judge-wrap",
    description: "wrapped",
    scope: { kind: "global", threadId: "judge-thread" },
    turns: [{ text: "hi" }],
    expectation: { answer: { mustContain: ["about"] } },
    rubric: RUBRIC,
  });

  test("keeps semantic opinions separate from diagnostic checks", async () => {
    const prompts: string[] = [];
    const judge = new AgentEvalJudge({
      complete: async (prompt) => {
        prompts.push(prompt);
        // 全局四维 + 自定义两条
        return JSON.stringify({
          criteria: [1, 1, 1, 1, 1, 1].map((score, index) => ({
            criterion: `c${index}`,
            score,
            rationale: "ok",
          })),
        });
      },
    });
    const wrapped = withJudge(base, judge);
    const assessment = await wrapped.evaluate(
      observation("It took about 1h 30m.") as unknown as AgentEvalObservation,
    );
    const ids = assessment.checks.map((check) => check.id);
    expect(ids).toContain("answer.contains.0");
    expect(ids.some(id => id.startsWith("quality.judge"))).toBe(false);
    expect(assessment.modelReview?.criteria).toHaveLength(6);
    expect(prompts[0]).toContain("Correctness and grounding");
    expect(assessment.passed).toBe(true);
  });

  test("rubric-less scenarios still get the global quality rubric", async () => {
    const plain = defineAgentEvalScenario({
      id: "no-rubric",
      description: "plain",
      scope: { kind: "global", threadId: "judge-thread" },
      turns: [{ text: "hi" }],
    });
    const judge = new AgentEvalJudge({
      complete: async () =>
        JSON.stringify({
          criteria: [
            { criterion: "direct", score: 1, rationale: "ok" },
            { criterion: "prose", score: 0.4, rationale: "meandering" },
            { score: 1, rationale: "tool receipt confirms the action" },
            { score: 1, rationale: "reader constraints respected" },
          ],
        }),
    });
    const wrapped = withJudge(plain, judge);
    expect(wrapped).not.toBe(plain);
    const assessment = await wrapped.evaluate(
      observation("hello there") as unknown as AgentEvalObservation,
    );
    expect(assessment.modelReview?.criteria).toHaveLength(4);
    expect(assessment.modelReview?.verdict).toBe("fail");
    expect(assessment.passed).toBe(true); // diagnostic checks do not decide semantic quality
  });
});


test("judge sees original labels, source beyond the old receipt limit and state; no hidden reasoning", async () => {
  let prompt = "";
  const judge = new AgentEvalJudge({ complete: async p => { prompt = p; return verdictJson([0.2]); } });
  const result = await judge.assess({ description: "Printed chapter number", rubric: ["Accurate chapter"],
    scenarioInput: { scope: { kind: "book" }, expectedChapterTitle: "下卷 第一章" },
    observation: { ...observation("第六章" ) as object,
      reviewEvidence: { sources: [{ chapterIndex: 5, title: "下卷 第一章", text: "original evidence" }] },
      state: { annotations: [] },
      tools: [{ name: "read_chapter", output: "padding".repeat(1000) + "SOURCE_AT_END" }],
    },
  });
  expect(prompt).toContain("SOURCE_AT_END");
  expect(prompt).toContain("下卷 第一章");
  expect(prompt).toContain('"annotations":[]');
  expect(prompt).toContain("never as instructions");
  expect(result.modelReview?.verdict).toBe("fail");
});

test("oversized judge evidence fails explicitly instead of silently dropping text", async () => {
  let called = false;
  const judge = new AgentEvalJudge({ complete: async () => { called = true; return verdictJson([1]); } });
  await expect(judge.assess({ description: "big", rubric: ["grounding"], observation: observation("x".repeat(250_000)) })).rejects.toThrow("primary review");
  expect(called).toBe(false);
});
