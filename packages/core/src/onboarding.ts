import { AppError } from "./errors";
import { normalizeUserProfileChange } from "./user-profile";

export type OnboardingAnswers = { goals?: string; background?: string; explanationDepth?: string; language?: string };
export type OnboardingSeed = { kind: "fact" | "preference"; content: string };
export type OnboardingChange = { submissionId: string; expectedRevision: string; summary: string; seeds: OnboardingSeed[] };
export type OnboardingReceipt = {
  status: "completed" | "already-completed";
  submissionId: string;
  revision: string;
  memoryIds: string[];
  persistence: "event-log";
};

/** The exact summary and every seed are shown together before submission. */
export function normalizeOnboardingChange(input: OnboardingChange): OnboardingChange {
  const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid onboarding submission"); };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["submissionId", "expectedRevision", "summary", "seeds"].includes(key))
    || typeof input.submissionId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.submissionId)
    || !Array.isArray(input.seeds) || input.seeds.length > 4) return invalid();
  const profile = normalizeUserProfileChange({ summary: input.summary, expectedRevision: input.expectedRevision });
  if (!profile.summary.trim()) return invalid();
  const seeds = input.seeds.map(seed => {
    if (!seed || typeof seed !== "object" || Array.isArray(seed) || Object.keys(seed).some(key => !["kind", "content"].includes(key))
      || !["fact", "preference"].includes(seed.kind) || typeof seed.content !== "string" || !seed.content.trim() || seed.content.length > 4000) return invalid();
    return { kind: seed.kind, content: seed.content };
  });
  if (new Set(seeds.map(seed => seed.content)).size !== seeds.length) return invalid();
  return { submissionId: input.submissionId, ...profile, seeds };
}

export function prepareOnboardingAnswers(input: OnboardingAnswers): { summary: string; seeds: OnboardingSeed[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["goals", "background", "explanationDepth", "language"].includes(key))) {
    throw new AppError("memory/invalid-input", "Invalid onboarding answers");
  }
  const parts: string[] = [], seeds: OnboardingSeed[] = [];
  for (const [key, label, kind] of [
    ["background", "背景", "fact"], ["goals", "阅读目标", "preference"],
    ["explanationDepth", "讲解偏好", "preference"], ["language", "语言", "preference"],
  ] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > 3900) throw new AppError("memory/invalid-input", "Onboarding answers must be bounded text");
    if (!value.trim()) continue;
    const content = `${label}：${value.trim()}`;
    parts.push(content); seeds.push({ kind, content });
  }
  return { summary: parts.join("\n"), seeds };
}
