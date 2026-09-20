import type { Book, ResolvedNavigation, TOCItem } from "../../../../foliate-js/src/book";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader-document-layout");
const chapterBlocks = "h1, h2, h3, h4, h5, h6, p, section, article, div";
type ChapterStarts = ReadonlyMap<number, readonly ResolvedNavigation[]>;

/** Href-less groups contribute their name, not a boundary. Nested sections stay
 * in their enclosing chapter, matching the reader's continuous scroll surface. */
export function readerChapterEntries(items: readonly TOCItem[], parents: string[] = []): { href: string; title?: string; aliases: string[] }[] {
  const hrefs = (items: readonly TOCItem[]): string[] => items.flatMap(item =>
    [...(item.href ? [item.href] : []), ...hrefs(item.subitems ?? [])]);
  return items.flatMap(item => {
    const path = [...parents, ...(item.label?.trim() ? [item.label.trim()] : [])];
    return item.href ? [{ href: item.href, title: path.join(" › ") || undefined, aliases: hrefs(item.subitems ?? []) }]
      : readerChapterEntries(item.subitems ?? [], path);
  });
}

export function readerChapterBlock(target: Node): Element | null {
  const element = target.nodeType === 1 ? target as Element : target.parentElement;
  return element?.closest(chapterBlocks) ?? element;
}

/** Navigation already resolves publisher anchors; use those same targets for
 * presentation, without splitting files or changing persisted CFI node paths. */
export async function prepareReaderChapterStarts(book: Book): Promise<ChapterStarts> {
  const starts = new Map<number, ResolvedNavigation[]>();
  if (book.rendition?.layout === "pre-paginated" || !book.resolveHref) return starts;
  // A nested subsection is not a new chapter. Href-less grouping labels do not
  // consume a level, so their chapter children still get boundaries.
  const targets = await Promise.all([...new Set(readerChapterEntries(book.toc ?? []).map(entry => entry.href))].map(async href => {
    try { return await book.resolveHref!(href); }
    catch (error) { log.warn("Could not resolve chapter boundary", { href, error }); return null; }
  }));
  for (const target of targets) {
    if (!target?.anchor || !book.sections[target.index]) continue;
    const group = starts.get(target.index) ?? [];
    group.push(target);
    starts.set(target.index, group);
  }
  return starts;
}

export function markReaderChapterStarts(doc: Document, index: number, starts: ChapterStarts): void {
  for (const { anchor } of starts.get(index) ?? []) {
    const target = typeof anchor === "function" ? anchor(doc) : anchor;
    if (!target || typeof target === "number") continue;
    const node = "startContainer" in target ? target.startContainer : target;
    // Keep a standalone empty anchor with its following heading. Moving only
    // the heading to a new column leaves TOC navigation on the previous page.
    const block = readerChapterBlock(node);
    if (!block || block === doc.body || !doc.body.contains(block)) continue;
    const before = doc.createRange();
    before.selectNodeContents(doc.body);
    before.setEndBefore(block);
    const hasPrevious = !!before.toString().trim() || Array.from(doc.body.querySelectorAll("img, svg, video, canvas"))
      .some(image => !!(image.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
    block.setAttribute("data-ra-chapter-start", hasPrevious ? "next" : "first");
  }
}

const scriptOrGraphic = "sup, sub, rt, rp, svg, math, pre, code, kbd, samp";

/** Keep publisher emphasis and larger type, but do not let malformed relative
 * sizes make reading text microscopic. Measure before writing any markers so
 * nested spans cannot compound the correction. Called after each stylesheet. */
export function normalizeReaderTextSizes(doc: Document): void {
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  for (const el of doc.querySelectorAll("[data-ra-small-text]")) el.removeAttribute("data-ra-small-text");
  const minimum = parseFloat(win.getComputedStyle(doc.body).fontSize) * 0.85;
  if (!Number.isFinite(minimum) || minimum <= 0) return;
  const parents = new Set<Element>();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement) parents.add(node.parentElement);
  }
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let value = styles.get(el);
    if (!value) { value = win.getComputedStyle(el); styles.set(el, value); }
    return value;
  };
  const small: Element[] = [];
  for (const el of parents) {
    if (el.closest(`${scriptOrGraphic}, script, style`) || parseFloat(style(el).fontSize) >= minimum - 0.01) continue;
    let script = false;
    for (let parent: Element | null = el; parent && parent !== doc.body; parent = parent.parentElement) {
      if (["super", "sub"].includes(style(parent).verticalAlign)) { script = true; break; }
    }
    if (!script) small.push(el);
  }
  for (const el of small) el.setAttribute("data-ra-small-text", "");
}
