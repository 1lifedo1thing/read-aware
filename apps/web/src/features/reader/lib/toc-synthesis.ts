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
 * - Missing entries. Some converted books (Calibre size-splits are the usual
 *   culprit) carry a nav with one or two entries — "Cover" / "Text" — while
 *   the spine holds many sections. When the nav covers too little of the
 *   spine, every uncovered linear section gets an entry labeled by its first
 *   heading — or, headingless, by its opening words.
 *
 * Run it on the parsed book BEFORE `view.open(book)`: foliate builds its TOC
 * progress (relocate's `tocItem`) from `book.toc` at open time, so rewriting
 * first aligns the engine and the app on the same map.
 */

import type { Book, BookSection, TOCItem } from "../../../../foliate-js/src/book";
import { createLogger } from "../../../platform/logger";

type SectionLike = Pick<BookSection, "id" | "linear" | "createDocument">;
type NavItemLike = TOCItem;
type BookLike = Pick<Book, "toc" | "splitTOCHref" | "getSectionHref" | "resolveHref"> & { sections?: SectionLike[] };
const log = createLogger("toc-synthesis");

/** Beyond this many sections, scanning every document is too costly — and a
 *  book that large with a tiny nav is practically nonexistent. */
const MAX_SYNTHESIZED_SECTIONS = 60;
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
/** Case, punctuation and spacing differ freely between a nav label and the
 *  heading it names ("Childhood: Abandoned and Chosen" vs "CHILDHOOD" +
 *  "Abandoned and Chosen"); compare the letters only. */
const labelKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");

/** File part of an href, canonicalized the way epub-utils does. */
function fileOf(href: string): string {
  return decodeURI(String(href).split("#")[0])
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

function flattenNav(items: NavItemLike[] | null | undefined): NavItemLike[] {
  return (items ?? []).flatMap((item) => [
    item,
    ...flattenNav(item.subitems ?? undefined),
  ]);
}

/** The section a nav href points at, by the engine's own mapping when it has one. */
async function sectionIndexOfHref(book: BookLike, href: string, sections: SectionLike[]): Promise<number> {
  if (typeof book.splitTOCHref === "function") {
    let split: Awaited<ReturnType<NonNullable<Book['splitTOCHref']>>>;
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

/** First heading text, else the opening words of the first substantial paragraph. */
function labelFromDocument(doc: Document): string | null {
  const heading = Array.from(doc.querySelectorAll("h1, h2, h3"))
    .map((el) => normalizeWhitespace(el.textContent ?? ""))
    .find((text) => text.length > 0);
  if (heading) return truncateLabel(heading);

  const candidates = [
    ...Array.from(doc.body?.querySelectorAll("p") ?? []),
    ...Array.from(doc.body?.children ?? []),
  ];
  for (const el of candidates) {
    const text = normalizeWhitespace(el.textContent ?? "");
    if (text.length >= MIN_LABEL_SOURCE_CHARS) return truncateLabel(text);
  }
  return null;
}

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
        const element = child as Element, tag = element.tagName.toLowerCase();
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
  const labels = [...new Set([...collapsed].map((item) => item.label?.trim() ?? ""))]
    .filter((label) => labelKey(label).length >= MIN_LABEL_KEY_CHARS);
  const listsChapters = (lines: readonly string[]) =>
    labels.filter((label) => opensWithLabel(label, lines)).length >= CONTENTS_PAGE_LABELS;

  const openings = new Map<number, Promise<string[] | null>>();
  const openingOf = (index: number): Promise<string[] | null> => {
    let pending = openings.get(index);
    if (!pending) {
      const section = sections[index]!;
      pending = section.linear === "no" || typeof section.createDocument !== "function"
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
    repaired, collapsed: collapsed.size, sectionsRead: openings.size, ms: Math.round(performance.now() - startedAt),
  });
  return repaired > 0;
}

/**
 * Repair a deficient nav in place. Collapsed targets are relocated first;
 * then, if the nav still covers too little of the spine, missing entries are
 * synthesized. Returns true when `book.toc` changed. Non-linear sections and
 * sections with no readable text stay out of synthesis (a chapter spanning
 * several files keeps a single entry at its first file — the rest just
 * continue it).
 */
export async function ensureUsableToc(target: BookLike): Promise<boolean> {
  const sections = target.sections ?? [];
  const linearIndexes = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.linear !== "no" && typeof section.createDocument === "function")
    .map(({ index }) => index);
  if (linearIndexes.length < MIN_SECTIONS_TO_BOTHER) return false;

  const flatNav = flattenNav(target.toc);
  const repaired = await repairCollapsedTargets(target, flatNav, sections);

  if (linearIndexes.length > MAX_SYNTHESIZED_SECTIONS) return repaired;
  const covered = await sectionIndexesCoveredByNav(target, flatNav, sections);
  const coverage = covered.size / linearIndexes.length;
  if (flatNav.length > 0 && coverage >= MIN_SPINE_COVERAGE) return repaired;

  const synthesized: NavItemLike[] = [];
  let added = 0;
  for (const index of linearIndexes) {
    const original = covered.get(index);
    if (original?.length) {
      // Keep the book's own entries where they exist — flattened, since the
      // synthesized neighbors have no hierarchy to nest under.
      synthesized.push(...original.map((item) => ({ label: item.label, href: item.href })));
      continue;
    }
    const section = sections[index];
    const href = sectionHref(target, section, index);
    if (!href) continue;
    try {
      const doc = await section.createDocument!();
      const label = labelFromDocument(doc);
      if (!label) continue;
      synthesized.push({ label, href });
      added++;
    } catch (error) {
      log.warn("Could not synthesize a chapter label", error);
    }
  }

  if (added === 0) return repaired;
  target.toc = synthesized;
  return true;
}
