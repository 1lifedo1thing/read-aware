/**
 * Pure checks behind the corpus probe's chapter findings: whether a TOC label is what the
 * reader actually finds at the entry's target.
 */

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 二 → 2, 十二 → 12, 一百零五 → 105: labels and headings number the same things either way. */
function chineseNumber(run: string): string {
  let total = 0,
    digit = 0;
  for (const char of run) {
    if (char === "百") {
      total += (digit || 1) * 100;
      digit = 0;
    } else if (char === "十") {
      total += (digit || 1) * 10;
      digit = 0;
    } else digit = CHINESE_DIGITS[char] ?? 0;
  }
  return String(total + digit);
}

/** Case-, width-, numeral- and punctuation-insensitive form for comparing labels with page text. */
export function normalizeLabel(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[零〇一二两三四五六七八九十百]+/gu, chineseNumber)
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Numbering words that labels and headings spell differently ("Chapter 3" / "3", "第三章" / "三"). */
const NUMBERING =
  /^(chapter|part|book|section|volume|vol|lecture|appendix|卷|第[0-9]+[章节回篇部卷讲集辑册]?)?[0-9ivxlcdm]*/u;

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

/** Labels numbered as chapters: two of them opening one section means one is unreachable. */
export const NUMBERED_CHAPTER = /第\s*[0-9一二三四五六七八九十百零〇两]+\s*[章回]|^chapter\s+\S+|^\d+$/iu;
