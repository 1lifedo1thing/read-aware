import { describe, expect, test } from "bun:test";
import { qualityGatePassed, qualityVerdict, summarizeQuality, type HumanReview } from "./reviews";
import { buildEvalSummary } from "./summary";
import { formatEvalReport, formatRunLine } from "./report";
import { evalSuites } from "./suites";
import { GLOBAL_QUALITY_RUBRIC } from "./rubric";
import type { EvalRunRecord } from "./types";

const record: EvalRunRecord = {
  id: "r", scenarioId: "s", suiteId: "reading", variantId: "base", repetition: 1, executionIndex: 1,
  status: "passed", startedAt: "", finishedAt: "", input: {}, output: {}, telemetry: { wallTimeMs: 1 },
  assessment: { passed: true, score: 1, checks: [] },
};
function review(verdict: HumanReview["verdict"], notes = "Tool read_chapter returns 下卷第一章; the answer incorrectly calls it 第六章."): Record<string, HumanReview> {
  return { "run:r": { targetId: "run:r", verdict, notes, dimensions: {}, flags: [], updatedAt: "" } };
}

describe("semantic acceptance across all suites", () => {
  test("every registered scenario serializes the four primary review dimensions", () => {
    for (const suite of Object.values(evalSuites)) for (const scenario of suite.scenarios) {
      for (const criterion of GLOBAL_QUALITY_RUBRIC) expect(scenario.rubric).toContain(criterion);
      expect((scenario.input as { rubric: string[] }).rubric).toEqual(scenario.rubric!);
    }
  });
  test("a historical assertion-green answer is pending, then fails on source-based review", () => {
    expect(qualityVerdict(record)).toBe("pending");
    expect(qualityVerdict(record, review("fail"))).toBe("fail");
    expect(qualityGatePassed(summarizeQuality([record]))).toBe(false);
    expect(qualityGatePassed(summarizeQuality([record], review("fail")))).toBe(false);
  });
  test("a valid paraphrase can pass primary review despite a keyword miss", () => {
    const missed = { ...record, status: "failed" as const, assessment: { passed: false, score: 0, checks: [] } };
    expect(qualityVerdict(missed, review("pass", "Turn 1 says 大史, source identifies 史强 as the same person. Keyword false alarm; requested fact is correct."))).toBe("pass");
  });
  test("numbers, blank opinions, partial and automatic opinions cannot close acceptance", () => {
    expect(qualityVerdict(record, review("pass", "  "))).toBe("pending");
    expect(qualityGatePassed(summarizeQuality([record], review("partial")))).toBe(false);
    const auto = { ...record, assessment: { ...record.assessment!, modelReview: { verdict: "pass" as const, criteria: [] } } };
    expect(qualityVerdict(auto)).toBe("pending");
    expect(qualityGatePassed(summarizeQuality([]))).toBe(false);
    expect(qualityVerdict({ ...record, status: "error" }, review("pass"))).toBe("error");
  });
  test("an auxiliary scorer failure cannot veto primary review of a completed answer", () => {
    const scoringError = { ...record, status: "error", error: { stage: "scoring" } };
    expect(qualityVerdict(scoringError)).toBe("pending");
    expect(qualityVerdict(scoringError, review("pass", "Complete answer matches original source; automated judge returned malformed JSON."))).toBe("pass");
    expect(qualityVerdict({ ...scoringError, error: { stage: "timeout" } })).toBe("pending");
    expect(qualityVerdict({ ...scoringError, output: undefined })).toBe("error");
    expect(qualityVerdict({ ...scoringError, error: { stage: "execution" } }, review("pass"))).toBe("error");
    expect(qualityVerdict({ id: "r", status: "error", error: { stage: "scoring" }, hasCompletedOutput: true })).toBe("pending");
  });
  test("CLI and reports foreground review status and label diagnostic scores", () => {
    const summary = buildEvalSummary("reading", ["base"], ["s"], [record]);
    expect(summary.quality?.pending).toBe(1);
    expect(formatEvalReport(summary)).toContain("1 pending review");
    expect(formatRunLine(record)).toContain("REVIEW PENDING");
    expect(formatRunLine(record)).toContain("diagnosticScore");
  });
});

test("deterministic action acceptance needs completed output and state evidence; reading stays pending", () => {
  const run = { id: "action", status: "pass", output: {}, input: { evaluation: "programmatic" },
    assessment: { passed: true, score: 1, checks: [{ id: "scope", category: "state" as const, passed: true, message: "Only target book changed" }] } };
  expect(qualityVerdict(run)).toBe("pass");
  expect(qualityVerdict({ ...run, output: undefined })).toBe("pending");
  expect(qualityVerdict({ ...run, assessment: { ...run.assessment, checks: [] } })).toBe("pending");
  expect(qualityVerdict({ ...run, input: { evaluation: "semantic" } })).toBe("pending");
  expect(qualityVerdict({ ...run, input: {} })).toBe("pending");
  expect(qualityVerdict({ ...run, assessment: { ...run.assessment, passed: false } })).toBe("fail");
});
