import { AppError, errorCode, type BookTextSnapshot } from "@read-aware/core";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { readerChapterBlock, readerChapterEntries } from "../../reader/lib/reader-document-layout";
import type { ResolvedNavigation } from "../../../../foliate-js/src/book";
import { sectionsComplete, snapshotFromText, type BookTextRecord, type ExtractedChapter, type TextPiece } from "./book-text-record";

type ExtractionOptions = {
  bookId: string;
  contentVersion: string;
  prior: BookTextRecord | null;
  signal: AbortSignal;
  yieldToReader(): Promise<void>;
  readSection?(read: () => Promise<string>): Promise<string>;
  save(record: BookTextRecord): Promise<void>;
  progress(snapshot: BookTextSnapshot): void;
  warn(message: string, error: unknown): void;
};

/** Section reads and checkpoints have independent outcomes. Only successful sections are reused. */
export async function extractBookText(book: FoliateBook, options: ExtractionOptions): Promise<BookTextRecord> {
  const { bookId, contentVersion, signal } = options;
  const sections = book.sections ?? [];
  const required = sections.flatMap((section, index) => section.linear === "no" ? [] : [index]);
  const prior = options.prior;
  const resume = prior && prior.bookId === bookId && prior.contentVersion === contentVersion
    && prior.sectionCount === sections.length && JSON.stringify(prior.required) === JSON.stringify(required);
  const pieces = new Map((resume ? prior.pieces : []).map(piece => [piece.sectionIndex, piece]));
  const failures = new Map<number, string>();
  const unsupported: number[] = [];
  let hasText = [...pieces.values()].some(piece => piece.text.trim().length > 0);
  // Per-section observation stays constant-size; sort/copy the growing text only at checkpoints.
  const progress = () => options.progress({ bookId, contentVersion, status: "preparing", text: hasText ? "available" : "unknown",
    chapterCount: 0, progress: { total: required.length, completed: pieces.size, failed: failures.size, unsupported: unsupported.length },
    ...(failures.size ? { errorCode: failures.values().next().value } : {}) });
  const targets = new Map<number, { href: string; title?: string; start: boolean; target: ResolvedNavigation }[]>();
  for (const entry of readerChapterEntries(book.toc ?? [])) {
    for (const href of [entry.href, ...entry.aliases]) {
      signal.throwIfAborted();
      const target = await book.resolveHref?.(href);
      if (!target || !required.includes(target.index)) continue;
      const group = targets.get(target.index) ?? [];
      group.push({ href, title: entry.title, start: href === entry.href, target });
      targets.set(target.index, group);
    }
  }
  const record = (): BookTextRecord => ({ version: 6, bookId, contentVersion, extractedAt: new Date().toISOString(), finalized: false,
    sectionCount: sections.length, required, pieces: [...pieces.values()].sort((a, b) => a.sectionIndex - b.sectionIndex),
    failures: [...failures].map(([sectionIndex, code]) => ({ sectionIndex, code })), unsupported: [...unsupported], chapters: [] });
  let sinceSave = 0, consecutiveFailures = 0;
  progress();
  for (const index of required) {
    signal.throwIfAborted();
    if (pieces.has(index)) continue;
    const section = sections[index]!;
    if (typeof section.getText !== "function" && typeof section.createDocument !== "function") {
      unsupported.push(index); progress(); continue;
    }
    await options.yieldToReader(); signal.throwIfAborted();
    try {
      const piece: TextPiece = { sectionIndex: index, ...(section.id == null ? {} : { href: String(section.id) }), text: "", starts: [], anchors: [] };
      const read = async () => {
        // Keep source text offsets until all anchor ranges have been sliced.
        // Normalizing first would move every boundary after whitespace runs.
        const doc = !section.getText && section.createDocument ? await section.createDocument() : undefined;
        const raw = doc?.body?.textContent ?? (section.getText ? await section.getText(signal) : "");
        for (const point of targets.get(index) ?? []) {
          let offset = 0;
          if (doc?.body) {
            const anchor = typeof point.target.anchor === "function" ? point.target.anchor(doc) : point.target.anchor;
            if (anchor == null && point.href.includes("#")) throw new AppError("library/text-extraction-failed", "Chapter anchor is missing from its source document");
            if (anchor && typeof anchor !== "number" && anchor !== doc.body && anchor !== doc.documentElement) {
              const node = "startContainer" in anchor ? anchor.startContainer : anchor;
              const block = point.start ? readerChapterBlock(node) : null;
              const before = doc.createRange(); before.selectNodeContents(doc.body);
              if (block && block !== doc.body) before.setEndBefore(block);
              else if ("startContainer" in anchor) before.setEnd(anchor.startContainer, anchor.startOffset);
              else before.setEndBefore(anchor);
              offset = before.toString().length;
            }
          }
          const position = { offset, href: point.href };
          piece.anchors.push(position);
          if (point.start) piece.starts.push({ ...position, title: point.title });
        }
        return raw;
      };
      piece.text = options.readSection ? await options.readSection(read) : await read();
      signal.throwIfAborted();
      hasText ||= piece.text.trim().length > 0;
      pieces.set(index, piece);
      consecutiveFailures = 0;
    } catch (error) {
      signal.throwIfAborted();
      options.warn("Book text section failed", error);
      failures.set(index, errorCode(error) ?? "library/text-extraction-failed");
      consecutiveFailures++;
    }
    progress();
    sinceSave++;
    if (sinceSave >= Math.max(25, Math.floor(pieces.size / 20)) || consecutiveFailures >= 5) {
      signal.throwIfAborted(); await options.save(record()); sinceSave = 0;
    }
    if (consecutiveFailures >= 5) break;
  }
  signal.throwIfAborted();
  const result = record();
  // Partial chapters could renumber subsequent chapter references on retry.
  // Do not publish them into Agent/digest/index consumers before completion.
  if (sectionsComplete(result)) {
    result.chapters = mergeTextChapters(result,
      sections.some(section => typeof section.getText === "function"));
    result.finalized = true;
  }
  await options.save(result);
  signal.throwIfAborted(); options.progress(snapshotFromText(result));
  return result;
}

/** Logical chapters follow TOC starts across spine files. A spine boundary is
 * never a chapter boundary when a navigable TOC exists. */
function mergeTextChapters(record: BookTextRecord, pageText: boolean): ExtractedChapter[] {
  const chapters: ExtractedChapter[] = [];
  const hasToc = record.pieces.some(piece => piece.starts.length > 0);
  let current: { title?: string; hrefs: string[]; texts: string[]; first: number; last: number; chars: number } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.texts.join(" ").replace(/\s+/g, " ").trim();
    // Preserve short titled sections too: silently dropping them renumbers the TOC.
    if (text && (hasToc || text.length >= 40)) {
      const pages = current.first === current.last ? `Page ${current.first + 1}` : `Pages ${current.first + 1}-${current.last + 1}`;
      chapters.push({ title: current.title ?? (pageText ? pages : undefined), text, hrefs: [...new Set(current.hrefs)] });
    }
    current = null;
  };
  for (const piece of record.pieces) {
    if (!hasToc && current && (!pageText || current.last - current.first >= 7 || current.chars >= 16_000)) flush();
    const starts = [...piece.starts].sort((a, b) => a.offset - b.offset);
    const offsets = [...new Set([0, ...starts.map(start => start.offset)])];
    for (const [position, offset] of offsets.entries()) {
      const end = offsets[position + 1] ?? piece.text.length;
      const start = starts.find(start => start.offset === offset);
      if (start) flush();
      current ??= { title: start?.title, hrefs: start ? [start.href] : [], texts: [], first: piece.sectionIndex, last: piece.sectionIndex, chars: 0 };
      if (offset === 0 && piece.href) current.hrefs.push(piece.href);
      current.hrefs.push(...piece.anchors.filter(anchor => anchor.offset >= offset && (anchor.offset < end || position === offsets.length - 1 && anchor.offset === end)).map(anchor => anchor.href));
      const text = piece.text.slice(offset, end);
      current.texts.push(text); current.last = piece.sectionIndex; current.chars += text.length;
    }
  }
  flush(); return chapters;
}
