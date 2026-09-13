import { expect, test } from "bun:test";
import { createInMemoryDeps } from "./fixtures";
import { highlightVerbatimAssessment, observeSelectionAnnotations } from "../evals/suites/realbook/annotation-assessment";

async function fixture(text = "before Selected sentence? after") {
  const setup = createInMemoryDeps({ chapters: { book: [{ text }] } });
  const result = await setup.deps.bookText.searchLocations({ bookId: "book", query: "Selected sentence" });
  return { ...setup, range: result.hits[0]!.range!, text };
}

test("precise fixture CFI rejects added punctuation and incorrect quote context", async () => {
  const { deps, range } = await fixture();
  for (const textQuote of [
    { exact: "Selected sentence?" },
    { exact: "Selected sentence", prefix: "wrong" },
    { exact: "Selected sentence", suffix: "wrong" },
  ]) {
    await expect(deps.bookText.readRange({ range: { ...range, textQuote } }))
      .rejects.toMatchObject({ code: "library/range-not-found" });
  }
  const page = await deps.bookText.readRange({ range: { ...range, textQuote: {
    exact: " Selected\u00ad sentence ", prefix: "before ", suffix: "? after",
  } }, offset: 3, limit: 4 });
  expect(page.text).toBe("ecte");
});

test("annotation fixture rejects mismatched, truncated, stale and conflicting source before writes", async () => {
  const { deps, stores, range } = await fixture();
  const highlight = { bookId: "book", range, text: "Selected sentence" };
  for (const input of [
    { ...highlight, text: "Selected sentence?" },
    { ...highlight, text: "Selected" },
    { ...highlight, bookId: "other" },
    { ...highlight, anchor: "other" },
    { ...highlight, chapter: "chapter" },
  ]) await expect(deps.annotations.createHighlight(input)).rejects.toMatchObject({ code: "annotations/invalid-input" });
  await expect(deps.annotations.createNote({ bookId: "book", body: "Note", range }))
    .rejects.toMatchObject({ code: "annotations/invalid-input" });
  await expect(deps.annotations.createHighlight({ ...highlight, range: { ...range, contentVersion: "stale" } }))
    .rejects.toMatchObject({ code: "reader/stale-location" });
  await expect(deps.annotations.createHighlight(highlight, AbortSignal.abort())).rejects.toThrow();
  expect(stores.annotations).toEqual([]);
});

test("persisted highlight and note retain the same verified range and anchor", async () => {
  const { deps, stores, range } = await fixture();
  const highlight = await deps.annotations.createHighlight({ bookId: "book", range, text: "Selected sentence" });
  const note = await deps.annotations.createNote({ bookId: "book", range, quotedText: "Selected sentence", body: "这里值得回头再读。" });
  for (const entry of [highlight, note]) {
    expect(entry.range).toEqual(range);
    expect(entry.anchor).toBe(range.cfi);
    expect(await deps.annotations.getAnnotation(entry.id)).toEqual(entry);
  }
  range.cfi = "mutated caller input";
  expect(highlight.range!.cfi).not.toBe(range.cfi);
  const state = await observeSelectionAnnotations(stores, deps);
  const assess = (value: unknown, bookId = "book", chapterIndex = 0) => highlightVerbatimAssessment(
    { state: value }, "before Selected sentence? after", "Selected sentence", bookId, chapterIndex);
  expect(assess(state).passed).toBe(true);
  expect(assess(state, "other").passed).toBe(false);
  expect(assess(state, "book", 1).passed).toBe(false);
  expect(assess(state.map(entry => ({ kind: entry.kind, text: entry.text }))).passed).toBe(false);
  expect(assess(state.map(entry => entry.kind === "note" ? { ...entry, range: undefined } : entry)).passed).toBe(false);
  expect(assess(state.map(entry => entry.kind === "note" ? { ...entry, text: "paraphrase" } : entry)).passed).toBe(false);
});

test("unanchored legacy writes remain supported but fail selected-passage acceptance", async () => {
  const { deps, stores, text } = await fixture();
  await deps.annotations.createHighlight({ bookId: "book", text: "Selected sentence" });
  await deps.annotations.createNote({ bookId: "book", quotedText: "Selected sentence", body: "这里值得回头再读。" });
  const state = await observeSelectionAnnotations(stores, deps);
  expect(highlightVerbatimAssessment({ state }, text, "Selected sentence", "book", 0).passed).toBe(false);
});

test("complete source verification handles quotes spanning multiple range pages", async () => {
  const text = "Selected sentence" + "x".repeat(24000);
  const { deps, range } = await fixture(text);
  range.cfi = `epubcfi(fixture:0:0:${text.length})`;
  const note = await deps.annotations.createNote({ bookId: "book", range, quotedText: text, body: "Long source" });
  expect(note.range).toEqual(range);
  await expect(deps.annotations.createNote({ bookId: "book", range, quotedText: text.slice(0, -1) + "y", body: "Mismatch after first page" }))
    .rejects.toMatchObject({ code: "annotations/invalid-input" });
});

test("reader session and navigation share the seeded book content version", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book", progressPercent: 0, status: "reading" }], chapters: { book: [{ text: "Selected sentence?" }] } });
  for (const action of [async () => {}, () => deps.reader.openBook("book"), () => deps.reader.reload()]) {
    await action();
    const session = await deps.reader.getSession();
    const result = await deps.bookText.searchLocations({ bookId: "book", query: "Selected sentence?", contentVersion: session.location!.contentVersion });
    expect(result.hits).toHaveLength(1);
    expect(result.contentVersion).toBe(session.location!.contentVersion);
  }
});
