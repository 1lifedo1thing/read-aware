/**
 * Fallback handling for deficient tables of contents. Two conversion defects
 * are repaired here, IN PLACE on `book.toc` before the view opens:
 *
 * - Collapsed targets. A converter that lost its chapter anchors keeps every
 *   label but points all of them at one spot (KF8 books with every entry at
 *   `kindle:pos:fid:0000:off:0000000000` are the usual shape). Navigation lands
 *   on the cover for every chapter, the current-chapter label is wrong, and
 *   the whole book reads as one chapter. The labels are still right, so each
 *   collapsed entry is relocated to the first later section that opens with
 *   its label.
 * - Missing entries. Some books carry a nav with only a few entries — a
 *   converter's "Cover" / "Text", or a set's volume titles with none of their
 *   chapters — while the spine holds many sections. When the nav covers too
 *   little of the spine, the navigation is rebuilt from the sections'
 *   headings: every heading that opens a section (and, where the section's href
 *   is its file, every further heading with an id) becomes an entry, nested by
 *   heading level under the entries before it — the book's own entries take the
 *   level of the heading their section opens with, and those without one that
 *   each head later entries are the book's divisions (a set's volumes). Sections
 *   without a heading continue the entry before them; only a book with no
 *   headings at all is labeled by opening words instead, its one-line divider
 *   pages (parts, years) heading the sections after them. Contents pages set as
 *   plain text are never entries.
 *
 * Synthesis parses every linear section, so it runs before the book opens only
 * when the book is small enough (SYNTHESIS_AT_OPEN_WEIGHT). A larger book opens
 * with its own navigation and the text extraction, which reads every section
 * anyway, synthesizes it from the headings it collected (`navigationFromOutlines`).
 * Either way the result is stored with the extracted text and handed back to
 * the next opening (`persisted`), which then parses nothing.
 *
 * Run it on the parsed book BEFORE `view.open(book)`: foliate builds its TOC
 * progress (relocate's `tocItem`) from `book.toc` at open time, so rewriting
 * first aligns the engine and the app on the same map.
 */

import type { Book, BookSection, TOCItem } from "../../../../foliate-js/src/book";
import { createLogger } from "../../../platform/logger";

type SectionLike = Pick<BookSection, "id" | "linear" | "createDocument"> & { size?: number };
type NavItemLike = TOCItem;
type BookLike = Pick<Book, "toc" | "splitTOCHref" | "getSectionHref" | "resolveHref"> & { sections?: SectionLike[] };
const log = createLogger("toc-synthesis");

/** Synthesis at open parses every linear section before the first page, so
 *  its cost is their markup, not their number (about 40 ms per MiB): at or
 *  below this section weight (EPUB/MOBI bytes, text-book characters) it runs
 *  as the book opens; above it, text extraction synthesizes it in the
 *  background for the next opening. */
const SYNTHESIS_AT_OPEN_WEIGHT = 4 * 1024 * 1024;
/** A nav covering less than this share of the linear spine is deficient. */
const MIN_SPINE_COVERAGE = 0.5;
const MIN_SECTIONS_TO_BOTHER = 4;
const LABEL_MAX_CHARS = 24;
const MIN_LABEL_SOURCE_CHARS = 6;

/** Two entries at one spot are a legitimate nav (a part and its first chapter
 *  share a file start); from three on, the targets have collapsed. */
const MIN_COLLAPSED_GROUP = 3;
/** Relocation reads sections in reading order, each at most once. */
const MAX_REPAIRED_SECTIONS = 512;
/** A chapter's label appears among its opening blocks: a heading, or a
 *  heading split over a few lines ("CHAPTER ONE" / "CHILDHOOD" / "Abandoned
 *  and Chosen"). */
const OPENING_BLOCKS = 8;
const OPENING_RUN = 3;
/** A contents page is a list of links, so link text never counts as a line a
 *  chapter opens with. A page that still opens with this many collapsed
 *  labels as plain text is listing chapters, not starting one (a chapter
 *  opens with its own few: a number, a title, a subtitle). The listing may
 *  follow a title and a picture, so more lines are read for this check than
 *  a chapter opening needs. */
const CONTENTS_PAGE_LABELS = 6;
const CONTENTS_SCAN_LINES = 24;
const MIN_LABEL_KEY_CHARS = 2;

const blockSelector = "h1, h2, h3, h4, h5, h6, p, li, blockquote, div, td, th";

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
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
/** 二 → 2, 十二 → 12, 一百零五 → 105. */
function chineseNumber(run: string): string {
  let total = 0,
    digit = 0;
  for (const char of run) {
    if (char === "百" || char === "十") {
      total += (digit || 1) * (char === "百" ? 100 : 10);
      digit = 0;
    } else digit = CHINESE_DIGITS[char] ?? 0;
  }
  return String(total + digit);
}

/** Case, punctuation, spacing and numerals differ freely between a nav label
 *  and the heading it names ("Childhood: Abandoned and Chosen" vs "CHILDHOOD" +
 *  "Abandoned and Chosen"; "全集1" vs "全集（一）"); compare the letters only. */
const labelKey = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[零〇一二两三四五六七八九十百]+/gu, chineseNumber)
    .replace(/[\p{P}\p{S}\s]+/gu, "");

/** File part of an href, canonicalized the way epub-utils does. */
function fileOf(href: string): string {
  return decodeURI(String(href).split("#")[0])
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

function flattenNav(items: NavItemLike[] | null | undefined): NavItemLike[] {
  return (items ?? []).flatMap((item) => [item, ...flattenNav(item.subitems ?? undefined)]);
}

/** The section a nav href points at, by the engine's own mapping when it has one. */
async function sectionIndexOfHref(book: BookLike, href: string, sections: SectionLike[]): Promise<number> {
  if (typeof book.splitTOCHref === "function") {
    let split: Awaited<ReturnType<NonNullable<Book["splitTOCHref"]>>>;
    try {
      split = await book.splitTOCHref(href);
    } catch (error) {
      log.warn("Could not resolve TOC section", error);
      split = null;
    }
    const first = split?.[0];
    if (typeof first === "number") return first >= 0 && first < sections.length ? first : -1;
  }
  const file = fileOf(href);
  return sections.findIndex((section) => {
    if (section.id == null) return false;
    const sectionFile = fileOf(String(section.id));
    return sectionFile === file || sectionFile.endsWith(file) || file.endsWith(sectionFile);
  });
}

/** Map each nav entry (with an href) to the section it lands in. */
async function sectionIndexesCoveredByNav(
  book: BookLike,
  nav: NavItemLike[],
  sections: SectionLike[],
): Promise<Map<number, NavItemLike[]>> {
  const covered = new Map<number, NavItemLike[]>();
  for (const item of nav) {
    if (!item.href) continue;
    const index = await sectionIndexOfHref(book, item.href, sections);
    if (index < 0) continue;
    const existing = covered.get(index);
    if (existing) existing.push(item);
    else covered.set(index, [item]);
  }
  return covered;
}

/** An entry must be something the engine can navigate to: the engine's own
 *  href for the section when it minted one (MOBI/KF8), else the section's
 *  file path (EPUB). A section with neither gets no entry — an unresolvable
 *  href is worse than a missing one. */
function sectionHref(book: BookLike, section: SectionLike, index: number): string | undefined {
  if (typeof book.getSectionHref === "function") return book.getSectionHref(index);
  return section.id != null && typeof book.splitTOCHref !== "function" ? String(section.id) : undefined;
}

/** A section's headings in document order, with each one's offset into the
 *  section text (the text extraction's coordinates) and the id that makes it
 *  addressable; and, for a headingless section, its opening words. Link text
 *  never labels a section: a contents page's first line names another chapter. */
export type SectionHeading = { level: number; text: string; id: string | null; offset: number };
/** `lead`: the section's opening lines (link text excluded) — its label when it has
 *  no heading, and what shows it to be a divider page or a contents page. */
export type SectionOutline = { headings: SectionHeading[]; lead: string[] };

export function readSectionOutline(doc: Document): SectionOutline {
  const body = doc.body;
  if (!body) return { headings: [], lead: [] };
  const headings: SectionHeading[] = [];
  // One walk in document order: text before a heading is its offset.
  // SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION, by value: the section's realm may have no `NodeFilter`.
  const walker = doc.createTreeWalker(body, 0x1 | 0x4 | 0x8);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== 1) {
      offset += node.nodeValue?.length ?? 0;
      continue;
    }
    const element = node as Element;
    if (!/^h[1-6]$/.test(element.localName)) continue;
    const text = normalizeWhitespace(element.textContent ?? "");
    if (!text) continue;
    headings.push({
      level: Number(element.localName.slice(1)),
      text: truncateLabel(text),
      id: element.id || element.querySelector("[id]")?.id || null,
      offset,
    });
  }
  return { headings, lead: openingBlockTexts(doc, OPENING_BLOCKS).map(truncateLabel) };
}

/** A headingless section's label: its first substantial opening line, or the
 *  one line a divider page holds ("咸丰元年"). */
const openingLabel = (outline: SectionOutline) =>
  outline.lead.length === 1 && labelKey(outline.lead[0]!).length >= MIN_LABEL_KEY_CHARS
    ? outline.lead[0]!
    : (outline.lead.find((line) => line.length >= MIN_LABEL_SOURCE_CHARS) ?? null);

function truncateLabel(text: string): string {
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text;
}

/** A block's text split at its line breaks, without link text: converters set
 *  a chapter's number and title in one paragraph separated by `<br>`, on
 *  contents pages and in some chapter openings alike, and a contents page's
 *  lines are links. */
function blockLines(block: Element): string[] {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    const text = normalizeWhitespace(current);
    if (text) lines.push(text);
    current = "";
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) current += child.textContent ?? "";
      else if (child.nodeType === 1) {
        const element = child as Element,
          tag = element.tagName.toLowerCase();
        if (tag === "br") flush();
        else if (tag === "a" && element.getAttribute("href")) flush();
        else walk(child);
      }
    }
  };
  walk(block);
  flush();
  return lines;
}

/** The lines of a document's first text-bearing blocks, innermost blocks only
 *  (a wrapper `div` repeats its children's text). */
export function openingBlockTexts(doc: Document, limit = OPENING_BLOCKS): string[] {
  const texts: string[] = [];
  for (const block of Array.from(doc.body?.querySelectorAll(blockSelector) ?? [])) {
    if (Array.from(block.children).some((child) => child.matches(blockSelector))) continue;
    for (const line of blockLines(block)) {
      texts.push(line);
      if (texts.length >= limit) return texts;
    }
  }
  return texts;
}

/** Whether `label` names one of the opening blocks, or a run of consecutive
 *  ones (a heading set over several lines). */
export function opensWithLabel(label: string, blocks: readonly string[]): boolean {
  const key = labelKey(label);
  if (key.length < MIN_LABEL_KEY_CHARS) return false;
  for (let start = 0; start < blocks.length; start++) {
    let run = "";
    for (let end = start; end < Math.min(blocks.length, start + OPENING_RUN); end++) {
      run += labelKey(blocks[end]!);
      if (run === key) return true;
      if (run.length >= key.length) break;
    }
  }
  return false;
}

/**
 * Relocate collapsed entries — three or more sharing one href — to the
 * sections that open with their labels. Nav order is reading order, so each
 * placed entry starts the search for the next at its own section (a chapter's
 * number and its title both open the same file); an entry whose label is not
 * found keeps its href. Returns true when any href changed.
 */
async function repairCollapsedTargets(book: BookLike, nav: NavItemLike[], sections: SectionLike[]): Promise<boolean> {
  if (sections.length > MAX_REPAIRED_SECTIONS) return false;
  const byHref = new Map<string, NavItemLike[]>();
  for (const item of nav) {
    if (!item.href) continue;
    const group = byHref.get(item.href);
    if (group) group.push(item);
    else byHref.set(item.href, [item]);
  }
  const collapsed = new Set<NavItemLike>();
  for (const group of byHref.values()) {
    if (group.length >= MIN_COLLAPSED_GROUP) for (const item of group) collapsed.add(item);
  }
  if (!collapsed.size) return false;
  const startedAt = performance.now();
  const labels = [...new Set([...collapsed].map((item) => item.label?.trim() ?? ""))].filter(
    (label) => labelKey(label).length >= MIN_LABEL_KEY_CHARS,
  );
  const listsChapters = (lines: readonly string[]) =>
    labels.filter((label) => opensWithLabel(label, lines)).length >= CONTENTS_PAGE_LABELS;

  const openings = new Map<number, Promise<string[] | null>>();
  const openingOf = (index: number): Promise<string[] | null> => {
    let pending = openings.get(index);
    if (!pending) {
      const section = sections[index]!;
      pending =
        section.linear === "no" || typeof section.createDocument !== "function"
          ? Promise.resolve(null)
          : Promise.resolve()
              .then(() => section.createDocument!())
              .then((doc) => {
                const lines = openingBlockTexts(doc, CONTENTS_SCAN_LINES);
                return listsChapters(lines) ? null : lines.slice(0, OPENING_BLOCKS);
              })
              .catch((error: unknown) => {
                log.warn("Could not read a section while repairing the table of contents", error);
                return null;
              });
      openings.set(index, pending);
    }
    return pending;
  };

  let repaired = 0;
  let cursor: number | undefined;
  for (const item of nav) {
    if (!collapsed.has(item) || !item.href) continue;
    const label = item.label?.trim() ?? "";
    if (labelKey(label).length < MIN_LABEL_KEY_CHARS) continue;
    const from = cursor ?? Math.max(0, await sectionIndexOfHref(book, item.href, sections));
    for (let index = from; index < sections.length; index++) {
      const blocks = await openingOf(index);
      if (!blocks || !opensWithLabel(label, blocks)) continue;
      const href = sectionHref(book, sections[index]!, index);
      if (!href) break;
      if (href !== item.href) {
        item.href = href;
        repaired++;
      }
      cursor = index;
      break;
    }
  }
  log.info("Repaired collapsed table-of-contents targets", {
    repaired,
    collapsed: collapsed.size,
    sectionsRead: openings.size,
    ms: Math.round(performance.now() - startedAt),
  });
  return repaired > 0;
}

type NavigationState = "source" | "repaired" | "synthesized" | "deferred" | "restored";
const navigationStates = new WeakMap<object, NavigationState>();

/** What `ensureUsableToc` did to this parsed book: kept its navigation, repaired
 *  targets, synthesized it now, left synthesis to text extraction, or restored
 *  a stored result. */
export function navigationState(book: object): NavigationState {
  return navigationStates.get(book) ?? "source";
}

/** Two labels name the same heading when one starts the other ("三体I" / "三体I 地球往事"). */
function namesHeading(label: string, heading: string): boolean {
  const a = labelKey(label),
    b = labelKey(heading);
  return a.length >= MIN_LABEL_KEY_CHARS && b.length >= MIN_LABEL_KEY_CHARS && (a.startsWith(b) || b.startsWith(a));
}

/**
 * The navigation rebuilt from section outlines (see the module comment), or
 * null when the headings add nothing. `outlines` holds each linear section
 * read; a section missing from it contributes only the book's own entries.
 */
export async function navigationFromOutlines(
  target: BookLike,
  outlines: ReadonlyMap<number, SectionOutline | null>,
): Promise<NavItemLike[] | null> {
  const sections = target.sections ?? [];
  const covered = await sectionIndexesCoveredByNav(target, flattenNav(target.toc), sections);
  const linear = sections.flatMap((section, index) => (section.linear === "no" ? [] : [index]));
  const usesHeadings = linear.some((index) => !covered.has(index) && outlines.get(index)?.headings.length);
  const entries: Entry[] = [];
  for (const index of linear) {
    const outline = outlines.get(index) ?? null;
    const own = covered.get(index);
    if (own?.length) {
      for (const item of own) {
        const heading = outline?.headings.find((candidate) => namesHeading(item.label ?? "", candidate.text));
        entries.push({
          item: { label: item.label, href: item.href },
          rank: heading?.level ?? DIVISION,
          section: index,
          synthesized: false,
        });
      }
      continue;
    }
    const section = sections[index]!;
    const href = sectionHref(target, section, index);
    if (!href || !outline) continue;
    const [first, ...rest] = outline.headings;
    if (first) {
      entries.push({ item: { label: first.text, href }, rank: first.level, section: index, synthesized: true });
      // Further headings are addressable only where the href is the file itself.
      if (!href.includes("#") && href === String(section.id))
        for (const heading of rest)
          if (heading.id)
            entries.push({
              item: { label: heading.text, href: `${href}#${heading.id}` },
              rank: heading.level,
              section: index,
              synthesized: true,
            });
      continue;
    }
    const label = usesHeadings ? null : openingLabel(outline);
    if (label)
      entries.push({
        item: { label, href },
        rank: dividerPage(outline) ? TITLE_PAGE : CONTENT,
        section: index,
        synthesized: true,
        lead: outline.lead,
      });
  }
  const kept = withoutListings(entries);
  if (!kept.some((entry) => entry.synthesized)) return null;
  confirmDivisions(kept);
  // Nest by rank: an entry belongs to the nearest earlier one of a shallower
  // rank. An entry without a rank stands on its own.
  const toc: NavItemLike[] = [];
  const open: Entry[] = [];
  for (const entry of kept) {
    if (entry.rank === null) {
      open.length = 0;
      toc.push(entry.item);
      continue;
    }
    while (open.length && open.at(-1)!.rank! >= entry.rank) open.pop();
    const parent = open.at(-1);
    if (parent) (parent.item.subitems ??= []).push(entry.item);
    else toc.push(entry.item);
    open.push(entry);
  }
  return toc;
}

/**
 * Where an entry nests in rebuilt navigation. Headings rank by level (1–6).
 * Without a heading, the book's own entry may be one of its divisions (a set's
 * volume, whose opening page is often a picture), ranked above every heading;
 * a synthesized one-line section may be a divider page (a part, a year),
 * ranked below the headings; any other headingless section is content.
 */
type Entry = {
  item: NavItemLike;
  rank: number | null;
  section: number;
  synthesized: boolean;
  /** A headingless section's opening lines. */
  lead?: readonly string[];
};
const DIVISION = 0;
const TITLE_PAGE = 7;
const CONTENT = 8;

/** A page holding one line that is a title ("第二部", "咸丰元年"), not a
 *  sentence (a photograph's caption): short, and not closed like a sentence.
 *  Lead lines are cut at LABEL_MAX_CHARS, with an ellipsis. */
const dividerPage = (outline: SectionOutline) =>
  outline.lead.length === 1 && outline.lead[0]!.length <= LABEL_MAX_CHARS && !/[。！？!?…]$/u.test(outline.lead[0]!);

/** A headingless section whose opening lines name two other entries lists
 *  them: a contents page set as plain text. A chapter opens with its own
 *  words, not with the titles of the sections after it. */
function withoutListings(entries: readonly Entry[]): Entry[] {
  const sectionsByLabel = new Map<string, Set<number>>();
  for (const entry of entries) {
    const key = labelKey(entry.item.label ?? "");
    if (key.length < MIN_LABEL_KEY_CHARS) continue;
    const found = sectionsByLabel.get(key);
    if (found) found.add(entry.section);
    else sectionsByLabel.set(key, new Set([entry.section]));
  }
  const namesOthers = (entry: Entry) =>
    (entry.lead ?? []).filter((line) => {
      const found = sectionsByLabel.get(labelKey(line));
      return found && [...found].some((section) => section !== entry.section);
    }).length >= 2;
  return entries.filter((entry) => !namesOthers(entry));
}

/**
 * Divisions and divider pages are recognized by what they do: each heads the
 * deeper entries after it. A book that divides itself this way does so more
 * than once, so a rank holds only when at least two of its candidates head
 * something; a lone one — a cover, a dedication before plain chapters — is
 * not a division. An unconfirmed own entry stands on its own; an unconfirmed
 * one-line section is content.
 */
function confirmDivisions(entries: Entry[]): void {
  for (const [rank, fallback] of [
    [DIVISION, null],
    [TITLE_PAGE, CONTENT],
  ] as const) {
    const candidates = entries.flatMap((entry, index) =>
      entry.rank === rank && !(rank === DIVISION && entry.synthesized) ? [index] : [],
    );
    const heading = candidates.filter((index) => {
      const next = entries[index + 1];
      return next?.rank != null && next.rank > rank;
    });
    if (heading.length < 2) for (const index of candidates) entries[index]!.rank = fallback;
  }
}

/**
 * Repair a deficient nav in place — or restore one repaired before
 * (`persisted`, stored with the extracted text). Collapsed targets are
 * relocated first; then, if the nav still covers too little of the spine, it
 * is rebuilt from the sections' headings, now or in the background (see the
 * module comment). Returns true when `book.toc` changed.
 */
export async function ensureUsableToc(
  target: BookLike,
  { persisted }: { persisted?: readonly NavItemLike[] | null } = {},
): Promise<boolean> {
  if (persisted?.length) {
    target.toc = structuredClone([...persisted]);
    navigationStates.set(target, "restored");
    return true;
  }
  const sections = target.sections ?? [];
  const linearIndexes = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.linear !== "no" && typeof section.createDocument === "function")
    .map(({ index }) => index);
  const settle = (state: NavigationState, changed: boolean) => {
    navigationStates.set(target, state);
    return changed;
  };
  if (linearIndexes.length < MIN_SECTIONS_TO_BOTHER) return settle("source", false);

  const flatNav = flattenNav(target.toc);
  const repaired = await repairCollapsedTargets(target, flatNav, sections);
  const kept = () => settle(repaired ? "repaired" : "source", repaired);

  const covered = await sectionIndexesCoveredByNav(target, flatNav, sections);
  const coverage = covered.size / linearIndexes.length;
  if (flatNav.length > 0 && coverage >= MIN_SPINE_COVERAGE) return kept();
  const weight = linearIndexes.reduce((sum, index) => sum + Math.max(0, sections[index]!.size ?? 0), 0);
  if (weight > SYNTHESIS_AT_OPEN_WEIGHT) {
    log.info("Table of contents too sparse; text extraction will rebuild it", { weight });
    return settle("deferred", repaired);
  }
  const outlines = new Map<number, SectionOutline | null>();
  for (const index of linearIndexes) {
    try {
      outlines.set(index, readSectionOutline(await sections[index]!.createDocument!()));
    } catch (error) {
      log.warn("Could not read a section's headings", error);
      outlines.set(index, null);
    }
  }
  const rebuilt = await navigationFromOutlines(target, outlines);
  if (!rebuilt) return kept();
  target.toc = rebuilt;
  return settle("synthesized", true);
}
