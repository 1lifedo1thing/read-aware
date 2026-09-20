/** Shared by every suite, saved with each scenario; custom criteria remain additive. */
export const GLOBAL_QUALITY_RUBRIC = [
  "Correctness and grounding: verify every material claim, quote, person, chapter title/number and source attribution against the recorded original evidence. chapterIndex is a retrieval coordinate, NEVER a printed chapter number. Distinguish inference and outside knowledge from this edition's text; a matching keyword is not proof.",
  "Completeness: answer the reader's actual question across all turns and requested constraints. Check what was omitted, contradicted, or promised but not delivered. Accept paraphrases and aliases when they preserve meaning; do not require the expected keywords verbatim.",
  "Helpfulness and execution: judge the outcome for this reader, using reading position, selected passage, memory, tool results, approvals/cancellations and before/after state. A tool call alone does not prove a successful action. Respect privacy, authorization and the book's applicable spoiler policy.",
  "Restraint and clarity: explain concretely in the reader's language with useful organization. Length alone is not a defect; flag excess only when it obstructs this request or violates an explicit preference. Do not reward polished prose that hides uncertainty or unsupported details.",
];
export function reviewRubric(custom: string[] = []): string[] {
  return [...new Set([...GLOBAL_QUALITY_RUBRIC, ...custom])];
}
