import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { defineAgentEvalScenario } from "./agent-harness";
import { captureReviewEvidence } from "./review-evidence";
import type { AgentEvalObservation } from "./types";

test("a TOC does not consume the source budget before the chapter actually read", () => {
  const scenario = defineAgentEvalScenario({ id: "source", description: "source", scope: { kind: "book", bookId: "b" }, turns: [{ text: "Read the fifth chapter" }],
    seed: { chapters: { b: [{ title: "前言", text: "x".repeat(200_000) }, { title: "上卷 第五章", hrefs: ["text#five"], text: "真实依据" }] } } });
  const { stores } = createInMemoryDeps(scenario.seed);
  const observation: AgentEvalObservation = { turns: [], answer: "", thinking: "", interactions: [], modelRequests: [], telemetry: { wallTimeMs: 0 },
    tools: [{ turn: 1, id: "toc", name: "get_toc", output: '[{"chapterIndex":0},{"chapterIndex":1}]' },
      { turn: 1, id: "read", name: "read_chapter", args: { chapterIndex: 1 } }], state: { saved: true } };
  const evidence = captureReviewEvidence(scenario, stores, observation, { saved: false }) as { sources: Array<{chapters: Array<{text?: string; textOmitted?: string; title: string}>}>; initialState: unknown; finalState: unknown };
  expect(evidence.sources[0]!.chapters[0]!.text).toBeUndefined();
  expect(evidence.sources[0]!.chapters[1]!.text).toBe("真实依据");
  expect(evidence.sources[0]!.chapters[1]!.title).toBe("上卷 第五章");
  expect(evidence.initialState).toEqual({ saved: false });
  expect(evidence.finalState).toEqual({ saved: true });
});
