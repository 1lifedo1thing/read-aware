import { expect, test } from "bun:test";
import { normalizeOnboardingChange, prepareOnboardingAnswers } from "./onboarding";

const candidate = () => ({ submissionId: "interview", expectedRevision: `profile2:${"a".repeat(64)}`, ...prepareOnboardingAnswers({ goals: " History ", background: "Engineer", language: "English" }) });
test("onboarding prepares the exact bounded summary and all seeds without inferred fields", () => {
  const input = candidate(), accepted = normalizeOnboardingChange(input);
  expect(accepted.seeds).toHaveLength(3);
  expect(accepted.summary).toContain("History");
  input.seeds[0]!.content = "Mutated";
  expect(accepted.seeds[0]!.content).not.toBe("Mutated");
  expect(prepareOnboardingAnswers({ goals: "   " })).toEqual({ summary: "", seeds: [] });
  for (const patch of [{ summary: "" }, { summary: "x".repeat(16001) }, { submissionId: "../id" }, { extra: true },
    { seeds: [{ kind: "fact", content: "" }] }, { seeds: [{ kind: "fact", content: "same" }, { kind: "preference", content: "same" }] }]) {
    expect(() => normalizeOnboardingChange({ ...candidate(), ...patch } as never)).toThrow();
  }
});
