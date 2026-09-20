export const REVIEW_DIMENSIONS = [
  { id: "correctness", label: "正确可信" },
  { id: "completeness", label: "回答完整" },
  { id: "helpfulness", label: "阅读帮助" },
  { id: "restraint", label: "表达分寸" },
] as const;

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number]["id"];
export type HumanVerdict = "pass" | "partial" | "fail";

export const REVIEW_FLAGS = [
  "事实错误",
  "缺少依据",
  "章节或进度错误",
  "剧透问题",
  "没有答完",
  "过度展开",
  "操作未兑现",
] as const;

export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export function verdictForScore(score: number): HumanVerdict {
  if (score >= 4) return "pass";
  if (score === 3) return "partial";
  return "fail";
}

export interface ReviewFinding {
  attribution: "product" | "assertion" | "fixture" | "judge" | "environment";
  evidence: string[];
  explanation: string;
}

export interface HumanReview {
  findings?: ReviewFinding[];
  targetId: string;
  score?: number;
  verdict?: HumanVerdict;
  dimensions: Partial<Record<ReviewDimension, number>>;
  flags: ReviewFlag[];
  notes: string;
  updatedAt: string;
}

export interface HumanReviewInput {
  findings?: ReviewFinding[];
  targetId: string;
  score?: number;
  verdict?: HumanVerdict;
  dimensions?: Partial<Record<ReviewDimension, number>>;
  flags?: ReviewFlag[];
  notes?: string;
}

export interface ManualReviewTurn {
  input?: unknown;
  reviewEvidence?: unknown;
  state?: unknown;
  id: string;
  question: string;
  answer: string;
  tools: Array<{ name: string; args?: unknown; output?: string; isError?: boolean }>;
  interactions: Array<{ phase: string; kind?: string; value?: unknown }>;
  telemetry: {
    wallTimeMs: number;
    rounds?: number;
    costUsd?: number;
    tokens?: { total: number };
  };
  createdAt: string;
}

export interface ManualReviewSession {
  id: string;
  runId: string;
  scenarioId: string;
  variantId: string;
  createdAt: string;
  model: { provider: string; id: string; thinkingLevel: string };
  inheritSelection: boolean;
  turns: ManualReviewTurn[];
  active?: boolean;
}

export interface CreateManualSessionInput {
  scenarioId: string;
  variantId: string;
  inheritSelection: boolean;
}

export interface AskManualSessionInput {
  question: string;
}

const DIMENSION_IDS = new Set<string>(REVIEW_DIMENSIONS.map((entry) => entry.id));
const FLAG_IDS = new Set<string>(REVIEW_FLAGS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeHumanReviewInput(value: unknown): Omit<HumanReview, "updatedAt"> {
  if (!isRecord(value) || typeof value.targetId !== "string" || !value.targetId.trim()) {
    throw new Error("review targetId is required");
  }
  const verdict = value.verdict;
  if (verdict !== undefined && verdict !== "pass" && verdict !== "partial" && verdict !== "fail") {
    throw new Error("review verdict must be pass, partial, or fail");
  }
  const score = value.score;
  if (score !== undefined && (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5)) {
    throw new Error("review score must be an integer from 1 to 5");
  }
  const dimensions: Partial<Record<ReviewDimension, number>> = {};
  if (value.dimensions !== undefined) {
    if (!isRecord(value.dimensions)) throw new Error("review dimensions must be an object");
    for (const [key, score] of Object.entries(value.dimensions)) {
      if (!DIMENSION_IDS.has(key) || typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
        throw new Error(`invalid review dimension ${key}`);
      }
      dimensions[key as ReviewDimension] = score;
    }
  }
  const rawFlags = value.flags ?? [];
  if (!Array.isArray(rawFlags) || rawFlags.some((flag) => typeof flag !== "string" || !FLAG_IDS.has(flag))) {
    throw new Error("review flags contain an unknown value");
  }
  const notes = value.notes ?? "";
  if (typeof notes !== "string" || notes.length > 20_000) {
    throw new Error("review notes must be at most 20000 characters");
  }
  let findings: ReviewFinding[] | undefined;
  if (value.findings !== undefined) {
    if (!Array.isArray(value.findings)) throw new Error("review findings must be an array");
    findings = value.findings.map(entry => {
      if (!isRecord(entry) || !["product", "assertion", "fixture", "judge", "environment"].includes(String(entry.attribution))
        || !Array.isArray(entry.evidence) || entry.evidence.length === 0 || !entry.evidence.every(e => typeof e === "string" && e.trim())
        || typeof entry.explanation !== "string" || !entry.explanation.trim()) throw new Error("each finding needs attribution, evidence references and an explanation");
      return { attribution: entry.attribution as ReviewFinding["attribution"], evidence: entry.evidence as string[], explanation: entry.explanation };
    });
  }
  return {
    targetId: value.targetId.trim(),
    ...(findings === undefined ? {} : { findings }),
    ...(score === undefined ? {} : { score }),
    ...(verdict === undefined
      ? score === undefined
        ? {}
        : { verdict: verdictForScore(score) }
      : { verdict }),
    dimensions,
    flags: [...new Set(rawFlags)] as ReviewFlag[],
    notes,
  };
}

export function reviewMean(review: HumanReview | undefined): number | undefined {
  if (!review) return undefined;
  if (review.score !== undefined) return review.score;
  const scores = Object.values(review.dimensions);
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}


/** Semantic quality needs primary review; opted-in deterministic actions use state checks. */
export interface ReviewableRun {
  input?: unknown;
  assessment?: import("./types").EvalAssessment;
  id: string;
  reviewTargetId?: string;
  status: string;
  error?: unknown;
  output?: unknown;
  /** Lightweight listings retain completion metadata without the transcript. */
  hasCompletedOutput?: boolean;
}
export type QualityVerdict = HumanVerdict | "pending" | "error";
export interface QualitySummary {
  total: number;
  pass: number;
  partial: number;
  fail: number;
  pending: number;
  error: number;
}
export function hasExecutionError(record: ReviewableRun): boolean {
  if (record.status !== "error" && !record.error) return false;
  const stage = isRecord(record.error) ? record.error.stage : undefined;
  // A scoring failure (including a judge timeout) does not erase a completed
  // answer. Keep its diagnostic error visible, and let primary review decide.
  const completed = record.hasCompletedOutput ?? (record.output !== undefined);
  return !(completed && (stage === "scoring" || stage === "timeout"));
}
export function qualityVerdict(record: ReviewableRun, reviews: Record<string, HumanReview> = {}): QualityVerdict {
  if (hasExecutionError(record)) return "error";
  const review = reviews[record.reviewTargetId ?? `run:${record.id}`];
  if (isRecord(record.input) && record.input.evaluation === "programmatic") {
    // Opt-in alone is insufficient: a completed observation and actual state
    // checks are mandatory. Tool names/keywords cannot certify a write.
    if (!(record.hasCompletedOutput ?? record.output !== undefined) || !record.assessment?.checks.some(check => check.category === "state")) return "pending";
    if (!record.assessment.passed) return "fail";
    return review?.notes?.trim() && review.verdict ? review.verdict : "pass";
  }
  // A number or a blank checkbox is not an evidence-based review.
  return review?.notes?.trim() && review.verdict ? review.verdict : "pending";
}
export function summarizeQuality(records: ReviewableRun[], reviews: Record<string, HumanReview> = {}): QualitySummary {
  const summary: QualitySummary = { total: records.length, pass: 0, partial: 0, fail: 0, pending: 0, error: 0 };
  for (const record of records) summary[qualityVerdict(record, reviews)]++;
  return summary;
}
export function qualityGatePassed(summary: QualitySummary): boolean {
  return summary.total > 0 && summary.pass === summary.total;
}
export function qualitySummaryText(summary: QualitySummary): string {
  return `${summary.pass}/${summary.total} accepted; ${summary.partial} partial, ${summary.fail} fail, ${summary.pending} pending review, ${summary.error} errors`;
}


export function manualReviewRecords(sessions: ManualReviewSession[]): ReviewableRun[] {
  return sessions.flatMap(session => session.turns.map(turn => ({ id: turn.id, status: "completed", reviewTargetId: `manual:${turn.id}` })));
}
export function plannedRunsComplete(
  plan: { scenarios: Array<{ id: string }>; variants: Array<{ id: string }>; repetitions: number },
  records: Array<{ scenarioId: string; variantId: string; repetition: number }>,
): boolean {
  const expected = new Set<string>();
  for (const scenario of plan.scenarios) for (const variant of plan.variants)
    for (let repetition = 1; repetition <= plan.repetitions; repetition++)
      expected.add(JSON.stringify([scenario.id, variant.id, repetition]));
  const actual = records.map(r => JSON.stringify([r.scenarioId, r.variantId, r.repetition]));
  return expected.size > 0 && actual.length === expected.size && new Set(actual).size === expected.size && actual.every(key => expected.has(key));
}
