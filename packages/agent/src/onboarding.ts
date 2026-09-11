import { normalizeOnboardingChange, prepareOnboardingAnswers, type OnboardingAnswers } from "@read-aware/core";
import type { RuntimeDeps } from "./ports";
import { runMemoryBuild } from "./memory/build-policy";

export type { OnboardingAnswers } from "@read-aware/core";
export const buildProfileSummary = (answers: OnboardingAnswers): string => prepareOnboardingAnswers(answers).summary;

/** The caller confirms this exact candidate before supplying its observed
 * revision and stable submission ID. Native owns atomicity and retry receipts. */
export async function applyOnboarding(
  deps: Pick<RuntimeDeps, "profile" | "memoryPolicy">,
  answers: OnboardingAnswers,
  decision: { submissionId: string; expectedRevision: string },
) {
  const candidate = normalizeOnboardingChange({ ...decision, ...prepareOnboardingAnswers(answers) });
  return runMemoryBuild(deps, operation => operation.commit(deps.profile.completeOnboarding)(candidate, operation.signal));
}
