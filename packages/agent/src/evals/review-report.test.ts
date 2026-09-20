import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshReviewReport } from "./review-report";
import { saveHumanReview, saveManualSession } from "./review-store";
import type { EvalRunRecord } from "./types";
import { buildEvalSummary } from "./summary";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });

test("assertion-green immutable records need actual reviews; a failed follow-up blocks the same gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "readaware-eval-review-")); directories.push(dir);
  const record: EvalRunRecord = { id: "s:q:base:1", suiteId: "s", scenarioId: "q", variantId: "base", repetition: 1, executionIndex: 1,
    status: "passed", startedAt: "", finishedAt: "", input: {}, output: {}, telemetry: { wallTimeMs: 1 }, assessment: { passed: true, score: 1, checks: [] } };
  const original = JSON.stringify(record) + "\n";
  await Promise.all([
    writeFile(join(dir, "runs.jsonl"), original),
    writeFile(join(dir, "summary.json"), JSON.stringify(buildEvalSummary("s", ["base"], ["q"], [record]))),
    writeFile(join(dir, "manifest.json"), JSON.stringify({ plan: { scenarios: [{ id: "q" }], variants: [{ id: "base" }], repetitions: 1 } })),
  ]);
  expect((await refreshReviewReport(dir)).accepted).toBe(false);
  await saveHumanReview(dir, { targetId: `run:${record.id}`, verdict: "pass", notes: "Original passage and tool receipt support the answer; no unsupported claims." });
  expect((await refreshReviewReport(dir)).accepted).toBe(true);
  await saveManualSession(dir, { id: "session", runId: "r", scenarioId: "q", variantId: "base", createdAt: "", model: { provider: "p", id: "m", thinkingLevel: "off" }, inheritSelection: false,
    turns: [{ id: "follow-up", question: "Why?", answer: "Invented source.", tools: [], interactions: [], telemetry: { wallTimeMs: 1 }, createdAt: "" }] });
  expect((await refreshReviewReport(dir)).accepted).toBe(false);
  await saveHumanReview(dir, { targetId: "manual:follow-up", verdict: "fail", notes: "Answer cites a source that is absent from both fixture and tools." });
  const result = await refreshReviewReport(dir);
  expect(result.summary.quality?.pass).toBe(1);
  expect(result.manualQuality.fail).toBe(1);
  expect(result.accepted).toBe(false);
  expect(await readFile(join(dir, "runs.jsonl"), "utf8")).toBe(original);
  expect(await readFile(join(dir, "report.md"), "utf8")).toContain("source that is absent");
});
