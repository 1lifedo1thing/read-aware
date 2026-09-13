import type { AnnotationItem, RuntimeDeps } from "../../../ports";
import { assessmentFromChecks } from "../../assertions";
import type { EvalAssessment } from "../../types";

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
  bookId: string, chapterIndex: number,
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
      passed: notes.length === 1 && notes[0]!.text === "这里值得回头再读。",
      message: "exactly one note must preserve the requested body" },
    { id: "state.selection-source-attached", category: "state",
      passed: highlights.length === 1 && notes.length === 1 && [...highlights, ...notes].every(attached)
        && notes[0]!.quotedText === selectedText
        && highlights[0]!.range?.cfi === notes[0]!.range?.cfi,
      message: "highlight and note must persist the same verified selected source range in the requested book and chapter" },
  ]);
}
