import { Checkbox, ChoiceGroup, TextArea } from "@read-aware/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  REVIEW_FLAGS,
  reviewMean,
  verdictForScore,
  type HumanReview,
  type HumanReviewInput,
  type HumanVerdict,
  type ReviewDimension,
  type ReviewFlag,
} from "../reviews";

interface ReviewDraft {
  score?: number;
  verdict?: HumanVerdict;
  dimensions: Partial<Record<ReviewDimension, number>>;
  flags: ReviewFlag[];
  notes: string;
}

function draftOf(review: HumanReview | undefined): ReviewDraft {
  const mean = reviewMean(review);
  return {
    ...(mean === undefined ? {} : { score: Math.round(mean) }),
    ...(review?.verdict ? { verdict: review.verdict } : {}),
    dimensions: review?.dimensions ?? {},
    flags: review?.flags ?? [],
    notes: review?.notes ?? "",
  };
}

function inputOf(targetId: string, draft: ReviewDraft): HumanReviewInput {
  return {
    targetId,
    ...(draft.score === undefined ? {} : { score: draft.score }),
    ...(draft.verdict === undefined ? {} : { verdict: draft.verdict }),
    dimensions: draft.dimensions,
    flags: draft.flags,
    notes: draft.notes,
  };
}

function signatureOf(targetId: string, draft: ReviewDraft): string {
  return JSON.stringify(inputOf(targetId, draft));
}

export function HumanReviewForm({
  targetId,
  review,
  onSave,
}: {
  targetId: string;
  review?: HumanReview;
  onSave: (input: HumanReviewInput) => Promise<void>;
}) {
  const initial = draftOf(review);
  const [draft, setDraft] = useState<ReviewDraft>(initial);
  const [state, setState] = useState<
    "idle" | "queued" | "saving" | "saved" | "error"
  >("idle");
  const draftRef = useRef(initial);
  const saveRef = useRef(onSave);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const lastSavedRef = useRef(signatureOf(targetId, initial));

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const flush = useCallback(
    async function persistDraft(): Promise<void> {
      const signature = signatureOf(targetId, draftRef.current);
      if (signature === lastSavedRef.current) return;
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }
      savingRef.current = true;
      setState("saving");
      let failed = false;
      try {
        await saveRef.current(inputOf(targetId, draftRef.current));
        lastSavedRef.current = signature;
        setState("saved");
      } catch {
        failed = true;
        setState("error");
      } finally {
        savingRef.current = false;
        if (
          !failed &&
          (pendingRef.current ||
            signatureOf(targetId, draftRef.current) !== lastSavedRef.current)
        ) {
          pendingRef.current = false;
          void persistDraft();
        }
      }
    },
    [targetId],
  );

  useEffect(() => {
    if (signatureOf(targetId, draft) === lastSavedRef.current) return;
    const timer = window.setTimeout(() => void flush(), 450);
    return () => window.clearTimeout(timer);
  }, [draft, flush, targetId]);

  const update = (change: (current: ReviewDraft) => ReviewDraft) => {
    setDraft((current) => {
      const next = change(current);
      draftRef.current = next;
      setState("queued");
      return next;
    });
  };

  return (
    <section
      className="mt-1 grid gap-2.5 border-y border-[var(--border)] py-3.5"
      aria-label="人工评测"
    >
      <div className="flex min-h-8 items-center gap-3 max-sm:flex-wrap">
        <span className="text-xs font-medium text-[var(--muted)]">
          你的评分
        </span>
        <ChoiceGroup
          ariaLabel="总体评分"
          value={draft.score === undefined ? "" : String(draft.score)}
          options={[1, 2, 3, 4, 5].map((score) => ({
            value: String(score),
            label: `${score} 分`,
          }))}
          onChange={(value) => {
            const score = Number(value);
            update((current) => ({
              ...current,
              score,
              verdict: verdictForScore(score),
            }));
          }}
        />
        <span
          className={`ml-auto text-[11px] ${
            state === "error" ? "text-[var(--fail)]" : "text-[var(--subtle)]"
          }`}
          aria-live="polite"
        >
          {state === "queued" || state === "saving"
            ? "保存中"
            : state === "saved"
              ? "已自动保存"
              : state === "error"
                ? "保存失败，修改后重试"
                : ""}
        </span>
      </div>

      <fieldset
        className="flex flex-wrap gap-x-5 gap-y-2 border-0 p-0"
        aria-label="问题标签"
      >
        {REVIEW_FLAGS.map((flag) => (
          <Checkbox
            key={flag}
            label={flag}
            checked={draft.flags.includes(flag)}
            onChange={(event) =>
              update((current) => ({
                ...current,
                flags: event.target.checked
                  ? [...current.flags, flag]
                  : current.flags.filter((entry) => entry !== flag),
              }))
            }
          />
        ))}
      </fieldset>

      <TextArea
        label="评语"
        variant="outlined"
        value={draft.notes}
        rows={2}
        placeholder="写下你的判断：哪里好，哪里不可信或不好用…"
        onBlur={() => void flush()}
        onChange={(event) =>
          update((current) => ({ ...current, notes: event.target.value }))
        }
      />
    </section>
  );
}
