/**
 * Chapter headings recovered from page text, for paged books (PDF) whose file
 * carries no outline. Only text is available — no font sizes — so a heading is
 * recognized by its form where headings appear: a numbered chapter/part line at
 * the top of a page. Two shapes cover real books:
 *
 * - an opener: the heading heads the chapter's first page, once;
 * - a running head: the chapter title repeats (with a page number) at the top
 *   of every page but the opener, which carries none — so the chapter starts
 *   on the page before the first repeat, when that page has no heading.
 *
 * Contents pages list many such lines and are skipped. Fewer than two headings
 * is no outline: a guess would be worse than the page groups used without one.
 */

export type PageHeading = { page: number; offset: number; label: string };

const CHAPTER_HEADING = new RegExp(
  [
    String.raw`^第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章回篇部讲]`,
    String.raw`^(?:chapter|part|lecture)\s+(?:[0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b`,
  ].join("|"),
  "iu",
);
/** Lines a page may open with before its heading (running head, page number). */
const HEAD_LINES = 2;
/** A page listing at least this many headings is a table of contents. */
const CONTENTS_LINES = 3;

/** A top-of-page line without the page number a running head carries. */
function headingLabel(line: string): string | null {
  const label = line
    .trim()
    .replace(/^[0-9]{1,4}\s+/u, "")
    .replace(/\s+[0-9]{1,4}$/u, "")
    .replace(/\s+/gu, " ");
  return CHAPTER_HEADING.test(label) ? label : null;
}

const same = (a: string, b: string) => a.replace(/\s+/gu, "") === b.replace(/\s+/gu, "");

export function detectPageHeadings(pages: readonly string[]): PageHeading[] {
  const found: (PageHeading | null)[] = pages.map((text, page) => {
    const lines = text.split("\n");
    if (lines.filter((line) => headingLabel(line)).length >= CONTENTS_LINES) return null;
    let offset = 0,
      seen = 0;
    for (const line of lines) {
      if (line.trim()) {
        const label = headingLabel(line);
        if (label) return { page, offset: offset + line.search(/\S/u), label };
        if (++seen >= HEAD_LINES) break;
      }
      offset += line.length + 1;
    }
    return null;
  });
  const headings: PageHeading[] = [];
  for (const [page, heading] of found.entries()) {
    if (!heading) continue;
    const previous = headings.at(-1);
    if (previous && same(previous.label, heading.label)) continue;
    // A title that repeats on the next pages is a running head; its chapter
    // opened on the headingless page before the first repeat.
    const repeats = found[page + 1] && same(found[page + 1]!.label, heading.label);
    const opener = page - 1;
    if (repeats && opener >= 0 && !found[opener] && (!previous || opener > previous.page))
      headings.push({ page: opener, offset: 0, label: heading.label });
    else headings.push(heading);
  }
  return headings.length >= 2 ? headings : [];
}
