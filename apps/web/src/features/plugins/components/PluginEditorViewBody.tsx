import { useEffect, useRef, useState } from "react";
import { Button, Caption, InlineError, Stack, TextArea } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { contributionText } from "../lib/plugin-i18n";
import type { PluginEditorView } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginEditorViewBodyProps = {
  view: PluginEditorView;
  busy: boolean;
  onResult: PluginResultRunner;
};

type EditorState = {
  draft: string;
  baseValue: string;
  baseRevision: string;
  stale: boolean;
  awaitingRevision?: boolean;
  error?: string;
};

function stateFor(view: PluginEditorView): EditorState {
  return {
    draft: view.value,
    baseValue: view.value,
    baseRevision: view.revision,
    stale: false,
  };
}

function firstFieldError(result: Awaited<ReturnType<PluginResultRunner>>): string | undefined {
  if (!result?.fieldErrors) return undefined;
  return Object.values(result.fieldErrors).find((value): value is string => typeof value === "string" && value.length > 0);
}

function reconcileSource(current: EditorState, view: PluginEditorView): EditorState {
  if (current.baseRevision === view.revision) return current;
  if (current.awaitingRevision && current.baseValue === view.value) {
    return { ...current, baseRevision: view.revision, stale: false, awaitingRevision: false };
  }
  if (current.draft !== current.baseValue) {
    return { ...current, stale: true, awaitingRevision: false, error: undefined };
  }
  return stateFor(view);
}

/**
 * Host-owned plain-text editing surface. Its draft is local to this mounted
 * frame, while the plugin remains responsible for the conditional business
 * write in `onSave(value, revision)`.
 */
export function PluginEditorViewBody({ view, busy, onResult }: PluginEditorViewBodyProps) {
  const { t } = useTranslation("plugins");
  const [state, setState] = useState(() => stateFor(view));
  const [saving, setSaving] = useState(false);
  const latestView = useRef(view);
  latestView.current = view;

  useEffect(() => {
    setState((current) => reconcileSource(current, view));
  }, [view.revision, view.value]);

  const reload = () => {
    if (busy || saving) return;
    setState(stateFor(view));
  };

  const cancel = () => {
    if (busy || saving) return;
    // Discard locally before invoking the optional navigation callback. A
    // callback is navigation only; it never receives the draft or revision.
    setState(stateFor(view));
    void onResult(() => view.onCancel ? view.onCancel() : ({ close: true }));
  };

  const save = () => {
    if (busy || saving || state.stale) return;
    if (state.draft.length > view.maxLength) {
      setState((current) => ({ ...current, error: t("viewer.editorTooLong", { max: view.maxLength }) }));
      return;
    }
    const submittedDraft = state.draft;
    const submittedRevision = state.baseRevision;
    setSaving(true);
    void onResult(() => view.onSave(submittedDraft, submittedRevision))
      .then((result) => {
        const error = firstFieldError(result);
        if (error) {
          setState((current) => ({ ...current, error }));
          return;
        }
        // The runner returns null for a failed/retired action. Keep the draft
        // in that case; only a completed callback result (including void) may
        // clear it.
        if (result === null) return;
        setState((current) => reconcileSource({
          ...current,
          // If the user kept typing while the request was in flight, only the
          // submitted snapshot becomes clean; the newer input stays dirty.
          baseValue: submittedDraft,
          baseRevision: submittedRevision,
          stale: false,
          // The new source can arrive before or after this promise settles.
          // Match the accepted value before adopting its new CAS revision.
          awaitingRevision: true,
          error: undefined,
        }, latestView.current));
      })
      // The host runner normally converts callback failures into a visible
      // failure toast and a null result. Keep direct runners safe as well.
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  const updateDraft = (value: string) => {
    const bounded = value.length > view.maxLength ? value.slice(0, view.maxLength) : value;
    setState((current) => ({ ...current, draft: bounded, error: undefined }));
  };

  return (
    <Stack as="form" gap="sm" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <TextArea
        label={contributionText(view.label)}
        variant="outlined"
        value={state.draft}
        maxLength={view.maxLength}
        aria-keyshortcuts="Control+Enter Meta+Enter Escape"
        onInput={(event) => updateDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
        error={state.error}
      />
      <Stack direction="horizontal" align="center" justify="between" gap="sm" wrap>
        <Caption aria-live="polite" className="text-fg-subtle">
          {state.draft.length} / {view.maxLength}
        </Caption>
        <Stack direction="horizontal" gap="sm" justify="end">
          <Button type="button" size="sm" variant="ghost" disabled={busy || saving} onClick={cancel}>
            {view.cancelLabel ? contributionText(view.cancelLabel) : t("externalResource.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={busy || saving || state.stale}>
            {view.saveLabel ? contributionText(view.saveLabel) : t("viewer.submit")}
          </Button>
        </Stack>
      </Stack>
      {state.stale && (
        <InlineError
          action={
            <Button type="button" size="sm" variant="ghost" disabled={busy || saving} onClick={reload}>
              {t("viewer.editorReload")}
            </Button>
          }
        >
          {t("viewer.editorStale")}
        </InlineError>
      )}
    </Stack>
  );
}
