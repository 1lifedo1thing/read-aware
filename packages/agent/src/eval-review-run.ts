import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { refreshReviewReport } from "./evals/review-report";
import { qualitySummaryText, qualityVerdict, normalizeHumanReviewInput } from "./evals/reviews";
import { buildReviewPacket, manualReviewPacket } from "./evals/review-packet";
import { readHumanReviews, readManualSessions, saveHumanReview } from "./evals/review-store";
import type { EvalRunRecord } from "./evals/types";

const args = parseArgs({ args: process.argv.slice(2), allowPositionals: true,
  options: { gate: { type: "boolean" }, help: { type: "boolean", short: "h" },
    list: { type: "boolean" }, case: { type: "string" }, diagnostics: { type: "boolean" }, save: { type: "string" } } });
if (args.values.help || !args.positionals[0]) {
  console.log(`Usage: bun run eval:review <bundle-directory> [--list | --case <targetId> [--diagnostics] | --save <review.json>] [--gate]
--list: JSON inventory of samples and primary review coverage.
--case: Full structured evidence for one run or manual turn; no scores unless --diagnostics.
--save: Merge a review object (or array) into human-reviews.json without overwriting other targets.
No inference calls. Default rebuilds review-first reports. --gate rejects pending, partial, failed, erroneous or incomplete acceptance.`);
} else {
  const directory = resolve(args.positionals[0]);
  if (args.values.gate && (args.values.list || args.values.case)) throw new Error("--gate requires a report refresh, not --list or --case");
  if ([args.values.list, args.values.case, args.values.save].filter(Boolean).length > 1) throw new Error("choose one of --list, --case or --save");
  const records = (await Bun.file(join(directory, "runs.jsonl")).text()).split("\n").filter(Boolean).map(line => JSON.parse(line) as EvalRunRecord);
  const sessions = await readManualSessions(directory);
  if (args.values.list) {
    const reviews = await readHumanReviews(directory);
    console.log(JSON.stringify([
      ...records.map(r => ({ targetId: `run:${r.id}`, scenarioId: r.scenarioId, variantId: r.variantId, repetition: r.repetition, quality: qualityVerdict(r, reviews) })),
      ...sessions.flatMap(s => s.turns.map(t => ({ targetId: `manual:${t.id}`, scenarioId: s.scenarioId, quality: qualityVerdict({ id: t.id, status: "completed", reviewTargetId: `manual:${t.id}` }, reviews) }))),
    ], null, 2));
  } else if (args.values.case) {
    const id = args.values.case;
    const record = records.find(r => r.id === id || `run:${r.id}` === id);
    const manual = sessions.flatMap(s => s.turns.map(t => ({ session: s, turn: t }))).find(({turn}) => `manual:${turn.id}` === id);
    if (!record && !manual) throw new Error(`unknown target ${id}; use --list for exact IDs`);
    console.log(JSON.stringify(record ? buildReviewPacket(record, args.values.diagnostics) : manualReviewPacket(manual!.session, manual!.turn), null, 2));
  } else {
    if (args.values.save) {
      const value: unknown = await Bun.file(resolve(args.values.save)).json();
      const reviews = (Array.isArray(value) ? value : [value]).map(normalizeHumanReviewInput);
      const targets = new Set([...records.map(r => `run:${r.id}`), ...sessions.flatMap(s => s.turns.map(t => `manual:${t.id}`))]);
      // Validate the complete batch before writing any target.
      for (const review of reviews) if (!targets.has(review.targetId)) throw new Error(`unknown review target ${review.targetId}`);
      for (const review of reviews) await saveHumanReview(directory, review);
    }
    const result = await refreshReviewReport(directory);
    console.log(`Quality: ${qualitySummaryText(result.summary.quality!)}`);
    console.log(`Follow-ups: ${qualitySummaryText(result.manualQuality)}`);
    console.log(`Acceptance: ${result.accepted ? "pass" : "not passed"}; planned run complete: ${result.complete}`);
    if (args.values.gate && !result.accepted) process.exitCode = 1;
  }
}
