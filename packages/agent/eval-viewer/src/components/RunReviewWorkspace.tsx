import { ChoiceGroup } from "@read-aware/ui";
import { Fragment, useMemo, useState } from "react";
import {
  ms,
  saveHumanReview,
  usd,
  type CatalogScenario,
  type RunRecord,
} from "../api";
import {
  reviewMean,
  qualityVerdict,
  type HumanReview,
  type ManualReviewSession,
} from "../reviews";
import { HumanReviewForm } from "./HumanReviewForm";
import { ManualSessionPanel } from "./ManualSessionPanel";
import { TranscriptView } from "./TranscriptView";

type ReviewFilter = "all" | "unreviewed" | "concerns";

const refChipClass =
  "inline-block select-all rounded-[5px] bg-[var(--accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]";

function humanScoreClass(review: HumanReview | undefined): string {
  if (!review?.notes.trim()) return "text-[var(--subtle)]";
  if (review?.verdict === "pass") return "text-[var(--ok)]";
  if (review?.verdict === "partial") return "text-[var(--err)]";
  if (review?.verdict === "fail") return "text-[var(--fail)]";
  return "text-[var(--subtle)]";
}

function runTargetId(record: RunRecord): string {
  return `run:${record.id}`;
}

function manualTargetId(turnId: string): string {
  return `manual:${turnId}`;
}

function isConcern(review: HumanReview | undefined): boolean {
  return review?.verdict === "partial" || review?.verdict === "fail";
}

function matchesFilter(
  review: HumanReview | undefined,
  filter: ReviewFilter,
): boolean {
  if (filter === "unreviewed")
    return !review?.verdict || !review.notes.trim();
  if (filter === "concerns") return isConcern(review);
  return true;
}

function humanScore(review: HumanReview | undefined): string {
  const score = reviewMean(review);
  return score === undefined
    ? "待审"
    : `${score.toFixed(score % 1 ? 1 : 0)} / 5`;
}

function recordTurns(record: RunRecord) {
  return (record.output?.turns ?? []).map((turn, index) => ({
    question: turn.input?.text ?? "",
    answer: turn.answer ?? "",
    selection: turn.input?.attachments?.[0]?.text,
    cursor: turn.input?.readingCursor,
    tools: (record.output?.tools ?? []).filter(
      (tool) => tool.turn === undefined || tool.turn === index + 1,
    ),
  }));
}

function ReviewEvidence({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details className="my-3 text-xs text-[var(--muted)]" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">原文、阅读边界与实际状态</summary>
    {open && <pre className="max-h-96 overflow-auto whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>}
  </details>;
}

function ReviewDiagnostics({
  record,
  scenario,
}: {
  record: RunRecord;
  scenario?: CatalogScenario;
}) {
  const checks = [...(record.assessment?.checks ?? [])].sort(
    (a, b) => Number(a.passed) - Number(b.passed),
  );
  const failed = checks.filter((check) => !check.passed).length;
  if (!scenario && checks.length === 0) return null;
  return (
    <details className="border-b border-[var(--border)] py-2.5">
      <summary className="flex cursor-pointer items-center gap-3 text-[11px] text-[var(--subtle)]">
        测试依据
        {checks.length > 0 && (
          <span className={`ml-auto ${failed ? "text-[var(--fail)]" : ""}`}>
            机器检查 {checks.length - failed}/{checks.length}
          </span>
        )}
      </summary>
      {scenario && (
        <div className="max-w-[900px] text-xs text-[var(--muted)]">
          <p>{scenario.description}</p>
          {(record.input ?? scenario.input).rubric?.length ? (
            <ul className="list-disc pl-5">
              {(record.input ?? scenario.input).rubric?.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {checks.length > 0 && (
        <ul className="mt-2.5 mb-1 grid list-none gap-1 p-0">
          {checks.map((check) => (
            <li
              key={`${check.id}-${check.message}`}
              className={`flex flex-wrap items-baseline gap-2 text-xs ${
                check.passed ? "" : "text-[var(--fail)]"
              }`}
            >
              <span
                className={`h-[7px] w-[7px] shrink-0 self-center rounded-full ${
                  check.passed ? "bg-[var(--ok)]" : "bg-[var(--fail)]"
                }`}
              />
              <span className="font-mono text-xs text-[var(--muted)]">
                {check.id}
              </span>
              <span>{check.message}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function RunReviewWorkspace({
  runId,
  records,
  refOf,
  scenarioOf,
  humanReviews,
  manualSessions,
  onReviewChange,
  onManualSessionChange,
}: {
  runId: string;
  records: RunRecord[];
  refOf: (scenarioId: string) => string;
  scenarioOf?: (scenarioId: string) => CatalogScenario | undefined;
  humanReviews: Record<string, HumanReview>;
  manualSessions: ManualReviewSession[];
  onReviewChange: (review: HumanReview) => void;
  onManualSessionChange: (session: ManualReviewSession) => void;
}) {
  const ordered = useMemo(
    () =>
      [...records].sort(
        (a, b) =>
          refOf(a.scenarioId).localeCompare(refOf(b.scenarioId), undefined, {
            numeric: true,
          }) ||
          a.variantId.localeCompare(b.variantId) ||
          a.repetition - b.repetition,
      ),
    [records, refOf],
  );
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const fixedReviews = records.map(
    (record) => humanReviews[runTargetId(record)],
  );
  const manualTurns = manualSessions.flatMap((session) => session.turns);
  const allReviews = [
    ...fixedReviews,
    ...manualTurns.map((turn) => humanReviews[manualTargetId(turn.id)]),
  ];
  const reviewed = allReviews.filter(
    (review) => review?.verdict && review.notes.trim(),
  );
  const concerns = reviewed.filter(isConcern);

  const persistReview = async (
    input: Parameters<typeof saveHumanReview>[1],
  ) => {
    const review = await saveHumanReview(runId, input);
    onReviewChange(review);
  };

  return (
    <section className="mt-2" aria-label="人工评测">
      <header className="flex items-center justify-between gap-4 border-y border-[var(--border)] py-2.5 max-sm:items-start">
        <div className="flex items-baseline gap-2 text-xs text-[var(--muted)]">
          <strong className="text-sm text-[var(--fg)] tabular-nums">
            {reviewed.length}/{records.length + manualTurns.length}
          </strong>
          <span>已评</span>
          {concerns.length > 0 && (
            <span className="text-[var(--fail)]">
              {concerns.length} 个有问题
            </span>
          )}
        </div>
        <ChoiceGroup
          ariaLabel="人工评测筛选"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "unreviewed", label: "待评" },
            { value: "concerns", label: "有问题" },
          ]}
        />
      </header>

      <div className="grid">
        {ordered.map((record) => {
          const targetId = runTargetId(record);
          const review = humanReviews[targetId];
          const verdict = qualityVerdict(record, humanReviews);
          const sessions = manualSessions.filter(
            (session) =>
              session.scenarioId === record.scenarioId &&
              session.variantId === record.variantId,
          );
          const showRecord = filter === "all" || (filter === "unreviewed" ? verdict === "pending"
            : verdict === "partial" || verdict === "fail" || verdict === "error");
          const visibleManualTurns = sessions.flatMap((session) =>
            session.turns
              .map((turn, index) => ({ session, turn, index }))
              .filter(({ turn }) =>
                matchesFilter(humanReviews[manualTargetId(turn.id)], filter),
              ),
          );
          if (!showRecord && visibleManualTurns.length === 0) return null;
          return (
            <Fragment key={record.id}>
              {showRecord && (
                <article
                  className="min-w-0 border-b border-[var(--border)] pb-8"
                  id={record.id}
                >
                  <header className="flex items-start justify-between gap-5 pt-5.5 pb-2.5 max-sm:gap-2.5">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2.5 max-sm:items-start">
                        <span className={refChipClass}>
                          {refOf(record.scenarioId)}
                        </span>
                        <h2 className="m-0 min-w-0 truncate font-mono text-sm leading-6 font-semibold tracking-normal max-sm:whitespace-normal max-sm:wrap-anywhere">
                          {record.scenarioId}
                        </h2>
                      </div>
                      <p className="mt-1 mb-0 text-[11px] text-[var(--subtle)]">
                        {record.variantId} · #{record.repetition} ·{" "}
                        {ms(record.telemetry.wallTimeMs)} ·{" "}
                        {usd(record.telemetry.costUsd)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] max-sm:grid max-sm:justify-items-end max-sm:gap-0.5">
                      <span className={`font-semibold ${verdict === "pass" ? "text-[var(--ok)]" : humanScoreClass(review)}`}>
                        {{ pass: "通过", partial: "部分达标", fail: "未通过", pending: "待语义审阅", error: "运行错误" }[verdict]}
                      </span>
                      <span className="text-[var(--subtle)]">辅助检查{record.status === "passed" ? "通过" : record.status === "failed" ? "有疑点" : "错误"}</span>
                      <span
                        className={`tabular-nums ${humanScoreClass(review)}`}
                      >
                        {review ? humanScore(review) : verdict === "pass" || verdict === "fail" ? "状态验证" : "—"}
                      </span>
                    </div>
                  </header>
                  {record.error && (
                    <div className="bg-[var(--fail-bg)] px-3 py-2.5 text-xs text-[var(--fail)]">
                      {record.error.stage} · {record.error.name}:{" "}
                      {record.error.message}
                    </div>
                  )}
                  <div className="min-w-0">
                    <TranscriptView turns={recordTurns(record)} />
                    <ReviewEvidence value={{ scenario: record.input, evidence: record.output?.reviewEvidence ?? "旧工件未记录原文快照，请对照本地 fixture", state: record.output?.state, interactions: record.output?.interactions }} />
                    {record.assessment?.modelReview && <details className="my-3 text-xs text-[var(--muted)]">
                      <summary className="cursor-pointer">自动初评 · {record.assessment.modelReview.verdict}（待主 Agent / 人工复核）</summary>
                      <ul className="list-disc pl-5">{record.assessment.modelReview.criteria.map((entry, index) => <li key={index}>{entry.criterion} — {entry.rationale} ({entry.score})</li>)}</ul>
                    </details>}
                    <HumanReviewForm
                      key={targetId}
                      targetId={targetId}
                      review={review}
                      onSave={persistReview}
                    />
                    <ReviewDiagnostics
                      record={record}
                      scenario={scenarioOf?.(record.scenarioId)}
                    />
                    <ManualSessionPanel
                      runId={runId}
                      record={record}
                      sessions={manualSessions}
                      onSessionChange={onManualSessionChange}
                    />
                  </div>
                </article>
              )}

              {visibleManualTurns.map(({ session, turn, index }) => {
                const manualTarget = manualTargetId(turn.id);
                const manualReview = humanReviews[manualTarget];
                return (
                  <article
                    className="min-w-0 border-b border-l-[3px] border-[var(--border)] border-l-[var(--accent)] pb-8 pl-6 max-sm:pl-3"
                    key={turn.id}
                  >
                    <header className="flex items-start justify-between gap-5 pt-5.5 pb-2.5 max-sm:gap-2.5">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={refChipClass}>
                            {refOf(record.scenarioId)}
                          </span>
                          <h2 className="m-0 min-w-0 text-sm leading-6 font-semibold tracking-normal">
                            自由问题 · 第 {index + 1} 轮
                          </h2>
                        </div>
                        <p className="mt-1 mb-0 text-[11px] text-[var(--subtle)]">
                          {session.model.provider}:{session.model.id}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] tabular-nums ${humanScoreClass(manualReview)}`}
                      >
                        {humanScore(manualReview)}
                      </span>
                    </header>
                    <div className="min-w-0">
                      <TranscriptView
                        turns={[
                          {
                            question: turn.question,
                            answer: turn.answer,
                            tools: turn.tools,
                          },
                        ]}
                      />
                      <ReviewEvidence value={{ input: turn.input, evidence: turn.reviewEvidence, state: turn.state, interactions: turn.interactions }} />
                      <HumanReviewForm
                        key={manualTarget}
                        targetId={manualTarget}
                        review={manualReview}
                        onSave={persistReview}
                      />
                    </div>
                  </article>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
