import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readHumanReviews,
  readManualSessions,
  reviewTargetExists,
  saveHumanReview,
  saveManualSession,
} from "./review-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "readaware-review-"));
  directories.push(directory);
  return directory;
}

describe("review store", () => {
  test("upserts reviews without losing other records", async () => {
    const directory = await temporaryDirectory();
    await saveHumanReview(directory, { targetId: "run:a", verdict: "pass" });
    await saveHumanReview(directory, { targetId: "run:b", verdict: "fail", notes: "事实错误" });
    await saveHumanReview(directory, { targetId: "run:a", verdict: "partial" });

    const reviews = await readHumanReviews(directory);
    expect(reviews["run:a"]?.verdict).toBe("partial");
    expect(reviews["run:b"]?.notes).toBe("事实错误");
    expect(JSON.parse(await readFile(join(directory, "human-reviews.json"), "utf8")).schemaVersion).toBe(1);
  });

  test("does not resurrect records after an artifact file is removed", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "human-reviews.json");
    await saveHumanReview(directory, { targetId: "run:old", verdict: "fail" });
    await rm(path);
    await saveHumanReview(directory, { targetId: "run:new", verdict: "pass" });

    expect(Object.keys(await readHumanReviews(directory))).toEqual(["run:new"]);
  });

  test("form edits preserve structured findings and corrupt companions cannot silently disappear", async () => {
    const directory = await temporaryDirectory();
    const findings = [{ attribution: "product" as const, evidence: ["turns[0].answer"], explanation: "Wrong original chapter title." }];
    await saveHumanReview(directory, { targetId: "run:a", verdict: "partial", notes: "Source mismatch", findings });
    await saveHumanReview(directory, { targetId: "run:a", score: 3, notes: "User adds details" });
    expect((await readHumanReviews(directory))["run:a"]?.findings).toEqual(findings);
    await saveHumanReview(directory, { targetId: "run:a", notes: "Resolved", findings: [] });
    expect((await readHumanReviews(directory))["run:a"]?.findings).toEqual([]);
    await expect(saveHumanReview(directory, { targetId: "run:a", findings: [{ ...findings[0]!, evidence: [] }] })).rejects.toThrow("evidence");
    await writeFile(join(directory, "human-reviews.json"), "{broken");
    await expect(readHumanReviews(directory)).rejects.toThrow();
    await writeFile(join(directory, "manual-sessions.json"), '{"schemaVersion":2,"sessions":[]}');
    await expect(readManualSessions(directory)).rejects.toThrow("invalid manual session file");
  });

  test("persists manual sessions in most-recent-first order", async () => {
    const directory = await temporaryDirectory();
    const base = {
      runId: "run-1",
      scenarioId: "scenario",
      variantId: "baseline",
      createdAt: "2026-08-22T00:00:00.000Z",
      model: { provider: "openrouter", id: "model", thinkingLevel: "medium" },
      inheritSelection: false,
      turns: [],
    };
    await saveManualSession(directory, { ...base, id: "one" });
    await saveManualSession(directory, { ...base, id: "two" });

    expect((await readManualSessions(directory)).map((session) => session.id)).toEqual(["two", "one"]);
  });

  test("only accepts review targets present in the run artifacts", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "runs.jsonl"), '{"id":"suite:scenario:baseline:1"}\n', "utf8");
    await saveManualSession(directory, {
      id: "session",
      runId: "run-1",
      scenarioId: "scenario",
      variantId: "baseline",
      createdAt: "2026-08-22T00:00:00.000Z",
      model: { provider: "openrouter", id: "model", thinkingLevel: "medium" },
      inheritSelection: false,
      turns: [
        {
          id: "session:1",
          question: "为什么？",
          answer: "因为。",
          tools: [],
          interactions: [],
          telemetry: { wallTimeMs: 10 },
          createdAt: "2026-08-22T00:00:01.000Z",
        },
      ],
    });

    expect(await reviewTargetExists(directory, "run:suite:scenario:baseline:1")).toBe(true);
    expect(await reviewTargetExists(directory, "manual:session:1")).toBe(true);
    expect(await reviewTargetExists(directory, "manual:missing")).toBe(false);
    expect(await reviewTargetExists(directory, "unknown:anything")).toBe(false);
  });
});
