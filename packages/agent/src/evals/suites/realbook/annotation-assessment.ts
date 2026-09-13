import type { Id } from "@read-aware/core";
import type { AnnotationItem, RuntimeDeps } from "../../../ports";
import { assessmentFromChecks } from "../../assertions";
import type { EvalAssessment } from "../../types";

/**
 * Seed an active selection through the same versioned range path the reader
 * exposes to the Agent.  Real-book scenarios must not describe a selection
 * only as an attachment while leaving reader.getSession().selection null.
 * The CFI shape is intentionally limited to the in-memory fixture reader.
 */
export async function selectFixtureRange(input: {
  deps: RuntimeDeps;
  bookId: Id;
  chapterIndex: number;
  text: string;
}) {
  const chapterText = await input.deps.bookText.getChapterText(
    input.bookId,
    input.chapterIndex,
  );
  if (!chapterText) {
    throw new Error(`fixture chapter ${input.chapterIndex} has no text`);
  }
  const start = chapterText.indexOf(input.text);
  if (start < 0) {
    throw new Error(`fixture selection is not in chapter ${input.chapterIndex}`);
  }
  const { contentVersion } = await input.deps.bookText.getNavigationToc(input.bookId);
  const range = {
    bookId: input.bookId,
    contentVersion,
    cfi: `epubcfi(fixture:${input.chapterIndex}:${start}:${start + input.text.length})`,
    textQuote: { exact: input.text },
  };
  const page = await input.deps.bookText.readRange({
    range,
    limit: 12000,
    contextChars: 0,
  });
  if (page.text !== input.text || page.nextOffset !== null) {
    throw new Error("fixture selection source mismatch");
  }
  await input.deps.reader.selectRange(page.range);
  return page.range;
}

export async function observeSelectionAnnotations(stores: { annotations: AnnotationItem[] }, deps: RuntimeDeps) {
  return Promise.all(stores.annotations.map(async (annotation) => {
    const range = "range" in annotation ? annotation.range : undefined;
    let sourceText: string | undefined, sourceSectionIndex: number | undefined;
    if (range) {
      try {
        let offset = 0;
        sourceText = "";
        do {
          const page = await deps.bookText.readRange({ range, offset, limit: 12000, contextChars: 0 });
          sourceText += page.text;
          sourceSectionIndex = page.sectionIndex;
          if (page.nextOffset === null) break;
          offset = page.nextOffset;
        } while (true);
      } catch { sourceText = undefined; sourceSectionIndex = undefined; }
    }
    return { kind: annotation.kind, bookId: annotation.bookId, anchor: annotation.anchor, range,
      text: annotation.kind === "highlight" ? annotation.text : annotation.kind === "note" ? annotation.body : "",
      quotedText: annotation.kind === "note" ? annotation.quotedText : undefined,
      sourceText, sourceSectionIndex };
  }));
}

export function highlightVerbatimAssessment(
  observation: { state?: unknown }, chapterText: string, selectedText: string,
  bookId: string, chapterIndex: number, expectedNoteBody = "这里值得回头再读。",
): EvalAssessment {
  const state = Array.isArray(observation.state)
    ? observation.state as Awaited<ReturnType<typeof observeSelectionAnnotations>> : [];
  const highlights = state.filter(entry => entry.kind === "highlight");
  const notes = state.filter(entry => entry.kind === "note");
  const attached = (entry: typeof state[number]) => !!entry.range
    && entry.bookId === bookId && entry.range.bookId === bookId
    && entry.anchor === entry.range.cfi && entry.sourceText === selectedText
    && entry.sourceSectionIndex === chapterIndex;
  return assessmentFromChecks([
    { id: "state.highlight-selection-boundary", category: "state",
      passed: highlights.length === 1 && highlights[0]!.text === selectedText,
      message: "highlight must match exactly the attached selection, without adjacent text",
      expected: selectedText, actual: highlights.map(entry => entry.text) },
    { id: "state.highlight-verbatim", category: "state",
      passed: highlights.length > 0 && highlights.every(entry => entry.text.length > 0 && chapterText.includes(entry.text)),
      message: "highlight must preserve source text", actual: highlights.map(entry => entry.text) },
    { id: "state.note-recorded", category: "state",
      passed: notes.length === 1 && notes[0]!.text === expectedNoteBody,
      message: "exactly one note must preserve the requested body",
      expected: expectedNoteBody,
      actual: notes.map(entry => entry.text) },
    { id: "state.selection-source-attached", category: "state",
      passed: highlights.length === 1 && notes.length === 1 && [...highlights, ...notes].every(attached)
        && notes[0]!.quotedText === selectedText
        && highlights[0]!.range?.cfi === notes[0]!.range?.cfi,
      message: "highlight and note must persist the same verified selected source range in the requested book and chapter" },
  ]);
}
