import type { AgentEvalScenario } from "./agent-harness";
import type { InMemoryStores } from "../testing/fixtures";
import type { AgentEvalObservation, JsonValue } from "./types";
import { toJsonValue } from "./json";

/** Archive original titles and touched source text, not just the model's quoted snippets.
 * Unrelated chapters retain coordinates/titles only; full books remain in local fixtures.
 * The explicit omission marker prevents a clipped chapter being mistaken for a complete source.
 */
export function captureReviewEvidence(
  scenario: AgentEvalScenario,
  stores: Pick<InMemoryStores, "books" | "chapters">,
  observation: AgentEvalObservation,
  initialState: unknown,
): JsonValue {
  const touched = new Map<string, Set<number>>();
  const add = (bookId: string | undefined, index: unknown) => {
    if (typeof index !== "number" || !Number.isInteger(index)) return;
    const ids = bookId ? [bookId] : [...stores.chapters.keys()];
    for (const id of ids) {
      if (!touched.has(id)) touched.set(id, new Set());
      touched.get(id)!.add(index);
    }
  };
  const scopeBook = scenario.scope.kind === "book" ? scenario.scope.bookId : undefined;
  const visit = (value: unknown, bookId = scopeBook): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) visit(child, bookId); return; }
    const entry = value as Record<string, unknown>;
    const id = typeof entry.bookId === "string" ? entry.bookId : bookId;
    add(id, entry.chapterIndex);
    for (const child of Object.values(entry)) visit(child, id);
  };
  for (const turn of scenario.turns) visit(turn);
  for (const tool of observation.tools) {
    if (tool.name === "get_toc") continue; // TOC indexes do not mean every chapter was read.
    visit(tool.args);
    if (tool.output) {
      try { visit(JSON.parse(tool.output)); } catch { /* Plain-text receipts are retained in tools. */ }
    }
  }
  let remaining = 180_000;
  return toJsonValue({
    scope: scenario.scope,
    books: stores.books,
    coordinatePolicy: "chapterIndex is a zero-based fixture retrieval coordinate, not a printed chapter number. Legacy EPUB fixtures group by spine file; use original titles/hrefs and source headings, never infer printed numbers from indexes.",
    sources: [...stores.chapters].map(([bookId, chapters]) => ({
      bookId,
      chapters: chapters.map((chapter, chapterIndex) => {
        const included = touched.get(bookId)?.has(chapterIndex) ?? false;
        const text = included ? chapter.text.slice(0, Math.max(0, remaining)) : undefined;
        if (text) remaining -= text.length;
        return { chapterIndex, title: chapter.title, hrefs: chapter.hrefs, totalChars: chapter.text.length,
          ...(text === undefined ? { textOmitted: "Not touched; available in the local fixture" }
            : { text, ...(text.length < chapter.text.length ? { textOmitted: `Source continues after offset ${text.length}; consult the local fixture` } : {}) }) };
      }),
    })),
    ...(initialState === undefined ? {} : { initialState }),
    ...(observation.state === undefined ? {} : { finalState: observation.state }),
  });
}
