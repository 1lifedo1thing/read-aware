/**
 * Pure checks behind the corpus probe's chapter findings: whether a TOC label is what the
 * reader actually finds at the entry's target, and whether chapter entries partition the
 * book in reading order.
 */

/** Case-, width- and punctuation-insensitive form for comparing labels with page text. */
export function normalizeLabel(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Numbering words that labels and headings spell differently ("Chapter 3" / "3", "第三章" / "三"). */
const NUMBERING =
  /^(chapter|part|book|section|volume|vol|lecture|appendix|卷|第[0-9一二三四五六七八九十百千零〇两]+[章节回篇部卷讲集辑册]?)?[0-9ivxlcdm一二三四五六七八九十百千零〇两]*/u;

/** The part of a label a heading must contain: the label without its numbering prefix. */
export function labelCore(label: string): string {
  const normalized = normalizeLabel(label);
  const core = normalized.replace(NUMBERING, "");
  return core.length >= 2 ? core : normalized;
}

/** Labels too generic to verify against text ("1", "Contents", "目录"). */
export function isCheckableLabel(label: string): boolean {
  const core = labelCore(label);
  return core.length >= 2 && !/^[0-9ivxlcdm]+$/u.test(core);
}

/**
 * Whether `found` — the text at an entry's target — opens with (or, for a page target,
 * contains) the label. Long labels are matched on a prefix: publishers shorten running
 * titles, and headings wrap subtitles onto another line or into another element.
 */
export function labelMatches(label: string, found: string): boolean {
  const text = normalizeLabel(found);
  const full = normalizeLabel(label);
  if (!text || !full) return false;
  if (text.includes(full)) return true;
  const core = labelCore(label);
  const probe = core.length > 12 ? core.slice(0, 12) : core;
  if (probe.length >= 2 && text.includes(probe)) return true;
  // A heading that drops the label's subtitle: "自由及其背叛" for "自由及其背叛：人类自由的六个敌人".
  const heading = normalizeLabel(found.trimStart().split("\n", 1)[0] ?? "");
  return heading.length >= 4 && full.startsWith(heading);
}

/** A reading position: spine section, then characters into it. */
export type Position = { index: number; offset: number };

export const comparePositions = (a: Position, b: Position) => a.index - b.index || a.offset - b.offset;

export type ChapterLayout = {
  label: string;
  start: Position | null;
  /** Positions of the entry's nested TOC entries. */
  children: (Position & { label: string })[];
};

export type ChapterStructure = {
  /** Entries whose start comes before the previous resolved entry's start. */
  outOfOrder: string[];
  /** Groups of differently labeled entries that land on the same position. */
  collapsed: string[][];
  /** Entries whose nested entries fall outside [own start, next start). */
  spilled: { label: string; outside: number; children: number; examples: string[] }[];
};

/** How chapter entries (top-level TOC items, in TOC order) partition the book. */
export function chapterStructure(chapters: ChapterLayout[]): ChapterStructure {
  const resolved = chapters.filter((chapter): chapter is ChapterLayout & { start: Position } => !!chapter.start);
  const outOfOrder: string[] = [];
  for (let index = 1; index < resolved.length; index++)
    if (comparePositions(resolved[index]!.start, resolved[index - 1]!.start) < 0)
      outOfOrder.push(resolved[index]!.label);
  const byPosition = new Map<string, Set<string>>();
  for (const chapter of resolved) {
    const key = `${chapter.start.index}:${chapter.start.offset}`;
    const labels = byPosition.get(key) ?? new Set<string>();
    labels.add(chapter.label.trim());
    byPosition.set(key, labels);
  }
  const collapsed = [...byPosition.values()].filter((labels) => labels.size > 1).map((labels) => [...labels]);
  const spilled: ChapterStructure["spilled"] = [];
  for (const [index, chapter] of resolved.entries()) {
    const next = resolved.slice(index + 1).find((later) => comparePositions(later.start, chapter.start) > 0);
    const outside = chapter.children.filter(
      (child) =>
        comparePositions(child, chapter.start) < 0 || (next !== undefined && comparePositions(child, next.start) >= 0),
    );
    if (outside.length)
      spilled.push({
        label: chapter.label,
        outside: outside.length,
        children: chapter.children.length,
        examples: outside.slice(0, 2).map((child) => {
          const where =
            comparePositions(child, chapter.start) < 0 ? "在本章开头之前" : `在下一章「${next!.label}」之后`;
          return `${child.label}（${where}）`;
        }),
      });
  }
  return { outOfOrder, collapsed, spilled };
}
