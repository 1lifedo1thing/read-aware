import { expect, test } from "bun:test";
import { buildReviewPacket, manualReviewPacket } from "./review-packet";
import type { EvalRunRecord } from "./types";
import type { ManualReviewSession } from "./reviews";

const record: EvalRunRecord = {
  id: "s:q:b:1", suiteId: "s", scenarioId: "q", variantId: "b", repetition: 1, executionIndex: 1,
  status: "passed", startedAt: "", finishedAt: "", input: { seed: { original: true } },
  telemetry: { wallTimeMs: 1 }, assessment: { passed: true, score: 1, checks: [] },
};

test("review packet preserves complete receipts and turn boundaries without hidden reasoning or scores", () => {
  const answer = "完整回答".repeat(2000);
  const packet = buildReviewPacket({ ...record, output: {
    answer, thinking: "PRIVATE_REASONING", modelRequests: [{ context: "PRIVATE_REQUEST" }],
    turns: [{ turn: 1, input: { text: "Delete it", readingCursor: { chapterIndex: 1 } }, answer: "Permission?", stateBefore: { exists: true }, stateAfter: { exists: true } },
      { turn: 2, input: { text: "No" }, answer, stateBefore: { exists: true }, stateAfter: { exists: true } }],
    tools: [{ turn: 2, id: "delete", name: "delete_book", args: { bookId: "b" }, output: JSON.stringify({ deleted: false, detail: "receipt".repeat(3000) }) }],
    interactions: [{ turn: 2, phase: "response", kind: "permission", value: "decline" }],
    reviewEvidence: { sources: [{ title: "真实原题" }] }, state: { exists: true },
  } });
  expect(packet.finalAnswer).toBe(answer);
  expect(packet.diagnostics).toBeUndefined();
  expect(JSON.stringify(packet)).not.toContain("PRIVATE_");
  expect(packet.turns).toMatchObject([{ tools: [], stateAfter: { exists: true } }, {
    tools: [{ id: "delete", result: { deleted: false, detail: "receipt".repeat(3000) } }],
    interactions: [{ value: "decline" }],
  }]);
  expect(packet.originalEvidence).toEqual({ sources: [{ title: "真实原题" }] });
  expect(buildReviewPacket(record, true).diagnostics).toEqual({ passed: true, score: 1, checks: [] });
});

test("legacy and interrupted artifacts state their evidence limitations", () => {
  expect(buildReviewPacket(record).originalEvidence).toMatchObject({ recordedSeed: { original: true } });
  const packet = buildReviewPacket({ ...record, status: "error", partialOutput: { answer: "unfinished", turns: [] } });
  expect(packet.execution).toMatchObject({ status: "error", evidence: "interrupted or missing output; not eligible for quality acceptance" });
  expect(packet.finalAnswer).toBe("unfinished");
  const scoring = buildReviewPacket({ ...record, status: "error", output: { answer: "complete" }, error: { stage: "scoring", name: "Error", message: "judge unavailable" } });
  expect(scoring.execution).toMatchObject({ status: "completed", diagnosticError: { stage: "scoring" } });
});

test("a manual follow-up includes preceding questions and parsed current receipts", () => {
  const session: ManualReviewSession = { id: "s", runId: "r", scenarioId: "q", variantId: "b", createdAt: "", inheritSelection: false,
    model: { provider: "p", id: "m", thinkingLevel: "off" },
    turns: [{ id: "t1", question: "Who?", answer: "Alice", tools: [], interactions: [], telemetry: { wallTimeMs: 1 }, createdAt: "" },
      { id: "t2", question: "Why her?", answer: "Source says so", tools: [{ name: "read_chapter", output: '{"text":"Alice"}' }], interactions: [], telemetry: { wallTimeMs: 1 }, createdAt: "" }] };
  expect(manualReviewPacket(session, session.turns[1]!)).toMatchObject({
    precedingTurns: [{ question: "Who?", answer: "Alice" }], question: "Why her?",
    tools: [{ name: "read_chapter", result: { text: "Alice" } }],
  });
});
