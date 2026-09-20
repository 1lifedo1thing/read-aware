import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readHumanReviews, readManualSessions } from "./review-store";
import { manualReviewRecords, plannedRunsComplete, qualityGatePassed, qualitySummaryText, qualityVerdict, summarizeQuality } from "./reviews";
import { formatEvalReport } from "./report";
import type { EvalRunPlan, EvalRunRecord, EvalSummary } from "./types";

/** Rebuild derived reports from the immutable runs and the existing review companion file.
 * No model calls and no rewriting of recorded answers/checks. Missing/corrupt evidence fails loudly.
 */
export async function refreshReviewReport(directory: string) {
  const [raw, summaryText, manifestText, reviews, sessions] = await Promise.all([
    readFile(join(directory, "runs.jsonl"), "utf8"),
    readFile(join(directory, "summary.json"), "utf8"),
    readFile(join(directory, "manifest.json"), "utf8"),
    readHumanReviews(directory), readManualSessions(directory),
  ]);
  const records = raw.split("\n").filter(Boolean).map(line => JSON.parse(line) as EvalRunRecord);
  const summary = JSON.parse(summaryText) as EvalSummary;
  const { plan } = JSON.parse(manifestText) as { plan: EvalRunPlan };
  const expected = plan.scenarios.length * plan.variants.length * plan.repetitions;
  const complete = plannedRunsComplete(plan, records);
  summary.quality = summarizeQuality(records, reviews);
  const manualRecords = manualReviewRecords(sessions);
  const manualQuality = summarizeQuality(manualRecords, reviews);
  const accepted = complete && qualityGatePassed(summary.quality)
    && (manualQuality.total === 0 || qualityGatePassed(manualQuality));
  summary.manualQuality = manualQuality;
  summary.qualityByVariant = plan.variants.map(v => ({ variantId: v.id, ...summarizeQuality(records.filter(r => r.variantId === v.id), reviews) }));
  const lines = [
    formatEvalReport(summary),
    "## Primary review evidence", "",
    `Planned samples: ${expected}; complete: ${complete}. Acceptance: ${accepted ? "pass" : "not passed"}.`, "",
    `Freeform follow-ups: ${qualitySummaryText(manualQuality)}`, "",
  ];
  for (const record of [...records, ...manualRecords]) {
    const target = ("reviewTargetId" in record ? record.reviewTargetId : undefined) ?? `run:${record.id}`;
    const review = reviews[target];
    lines.push(`### ${record.id}: ${qualityVerdict(record, reviews)}`, "",
      review?.notes || "Pending primary review of question, source, full answer, tools and actual state.", "");
    for (const finding of review?.findings ?? []) lines.push(`- ${finding.attribution}: ${finding.explanation} [${finding.evidence.join(", ")}]`, "");
    if ("assessment" in record && record.assessment?.modelReview) {
      lines.push(`Automated opinion (provisional): ${record.assessment.modelReview.verdict}`, "",
        ...record.assessment.modelReview.criteria.map(c => `- ${c.score}: ${c.criterion} — ${c.rationale}`), "");
    }
  }
  await Promise.all([
    writeFile(join(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(join(directory, "report.md"), lines.join("\n")),
    writeFile(join(directory, "review-summary.json"), `${JSON.stringify({ quality: summary.quality, manualQuality, complete, accepted }, null, 2)}\n`),
  ]);
  return { summary, manualQuality, complete, accepted };
}
