// READAWARE: the book's chapters, derived once from its navigation.
//
// The reader (chapter windows, page breaks before chapters) and the text
// extractor (the chapters search, digests and the Agent address) must agree on
// where chapters begin, so both consume this map instead of reading `book.toc`
// themselves.
//
// Two decisions shape it:
//
// - Reading order, not TOC order. A chapter is the stretch of the book from one
//   boundary to the next *in the spine*. Publishers' navigation is often out of
//   step with the spine: bundle editions gather every volume's title page at
//   the front while the volumes' text follows much later, and outlines put a
//   part's first chapter after the next part's start. Sorting by position means
//   such a book can mislabel a stretch, but never stretch one "chapter" across
//   the rest of the book.
// - Chapter level, not TOC level. The top level of a TOC is usually the chapter
//   level, but not always: a single root ("the book") or volumes/parts
//   ("三体III", "第三编", "Part II") hold the chapters one level down. A level
//   descends when it is made of containers; a node descends on its own when its
//   subtree has come apart from its own target. Subsections never become
//   chapters on their own: nothing descends into a chapter merely because it
//   has nested entries.

import type { Book, BookSection, ResolvedNavigation, TOCItem } from "./book.js";

export type ChapterMapEntry = {
  href: string;
  /** Label path from the top of the TOC, e.g. "三体III › 第一部 › 1". */
  title: string;
  /** 1 for top-level entries; href-less grouping labels do not count. */
  depth: number;
  target: ResolvedNavigation;
};

export type ChapterMap = {
  /** Chapter starts, in reading order. */
  chapters: ChapterMapEntry[];
  /** Every resolvable TOC entry, in reading order: navigation targets inside chapters. */
  entries: ChapterMapEntry[];
};

type ChapterMapBook = Pick<Book, "toc" | "resolveHref"> & { sections: Pick<BookSection, "size" | "linear">[] };

type Node = {
  href: string | null;
  label: string;
  path: string[];
  depth: number;
  /** Preorder rank in the TOC: the tie-break between targets in one section. */
  order: number;
  children: Node[];
  target: ResolvedNavigation | null;
};

/** Levels to descend at most: bundle › volume › part › chapter covers real books. */
const MAX_DESCENT = 6;
/** A node spanning more than this share of the book is the book, or a part of it — not a chapter. */
const DOMINANT_SHARE = 0.5;
/**
 * A node spanning more section weight than this is a volume. Weights are
 * format units (EPUB/MOBI bytes, text-book characters, a nominal size per PDF
 * page); 400 000 bytes of XHTML is roughly 130 000 CJK or 300 000 Latin
 * characters with markup — more than any chapter a reader would sit through.
 */
const VOLUME_WEIGHT = 400_000;
/**
 * Children shorter than this on average are not chapters but the items of
 * one — a collection's letters or memorials, a poet's poems — and a container
 * of them stays the chapter (about 2 000 CJK or 5 000 Latin characters). The
 * average, not the median: a book's many short front-matter entries must not
 * make its chapters look like items.
 */
const MIN_CHAPTER_WEIGHT = 6_000;
/**
 * Labels that name a container of chapters: parts, books of a work, volumes of
 * a set. 卷 is left out on purpose — in classical texts a 卷 is the chapter —
 * and a genuinely large 卷 descends by weight instead.
 */
const CONTAINER_LABEL = new RegExp(
  [
    String.raw`^第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[部编辑册篇]`,
    String.raw`^[上中下]\s*[部编篇册]`,
    String.raw`^(?:part|book|volume|vol\.)\s+(?:[0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b`,
  ].join("|"),
  "iu",
);

/** Labels numbered as chapters (not sections: 第X节 and "1.2" stay below chapter level). */
const CHAPTER_LABEL = new RegExp(
  [
    String.raw`^第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章回]`,
    String.raw`^chapter\s*(?:[0-9]+|[ivxlcdm]+\b|[a-z]+\b)`,
    String.raw`^[0-9]{1,3}(?:\s*[/、.．]\s*(?![0-9])|\s+|$)`,
    String.raw`^[一二三四五六七八九十百]+(?:\s*[、.．]|\s+|$)`,
  ].join("|"),
  "iu",
);
/** Whether a label is numbered as a chapter ("第三章 …", "Chapter 3", "3"), not as a section. */
const isChapterLabel = (label: string) => CHAPTER_LABEL.test(label.trim());

/** Labels that are mostly numbered chapters: what a volume or a part holds. */
const holdsNumberedChapters = (labels: readonly string[]) =>
  labels.length >= 3 && labels.filter(isChapterLabel).length >= labels.length * 0.6;

const numberedChapters = (children: readonly Node[]) => holdsNumberedChapters(children.map((child) => child.label));

function buildTree(items: readonly TOCItem[], parents: string[], depth: number, counter: { next: number }): Node[] {
  return items.flatMap((item): Node[] => {
    const label = item.label?.trim() ?? "";
    const path = label ? [...parents, label] : parents;
    // A grouping label without a target contributes its name, not a level.
    if (!item.href) return buildTree(item.subitems ?? [], path, depth, counter);
    const order = counter.next++;
    return [
      {
        href: item.href,
        label,
        path,
        depth,
        order,
        children: buildTree(item.subitems ?? [], path, depth + 1, counter),
        target: null,
      },
    ];
  });
}

const walk = (nodes: readonly Node[]): Node[] => nodes.flatMap((node) => [node, ...walk(node.children)]);

/** Reading order: spine section first, TOC order within a section. */
function compare(a: Node, b: Node): number {
  return a.target!.index - b.target!.index || a.order - b.order;
}

/** Targets at the very start of one section are one place; other targets are their href. */
function place(node: Node): string {
  const { index, anchor } = node.target!;
  return anchor == null || anchor === 0 ? `${index}` : `${index}#${node.href}`;
}

function entry(node: Node): ChapterMapEntry {
  return { href: node.href!, title: node.path.join(" › "), depth: node.depth, target: node.target! };
}

export async function buildChapterMap(book: ChapterMapBook): Promise<ChapterMap> {
  const tree = buildTree(book.toc ?? [], [], 1, { next: 0 });
  const all = walk(tree);
  if (!book.resolveHref || !all.length) return { chapters: [], entries: [] };
  const resolveHref = book.resolveHref.bind(book);
  const resolved = new Map<string, Promise<ResolvedNavigation | null>>();
  await Promise.all(
    all.map(async (node) => {
      let target = resolved.get(node.href!);
      if (!target) {
        target = Promise.resolve()
          .then(() => resolveHref(node.href!))
          .then((value) => (value && book.sections[value.index] ? value : null))
          // An entry that does not resolve cannot bound a chapter; its
          // children, if they resolve, take its place.
          .catch(() => null);
        resolved.set(node.href!, target);
      }
      node.target = await target;
    }),
  );
  const placed = (nodes: readonly Node[]) => nodes.filter((node) => node.target);
  const entries = placed(all).sort(compare);
  if (!entries.length) return { chapters: [], entries: [] };

  const weights = book.sections.map((section) => (section.linear === "no" ? 0 : Math.max(0, section.size ?? 0)));
  const prefix = [0];
  for (const weight of weights) prefix.push(prefix.at(-1)! + weight);
  const total = prefix.at(-1)!;
  /**
   * Section weight a node owns: its sections up to `next` (or the end of the
   * book). A section shared with an earlier node belongs to that node — within
   * one file there are no weights to split, so later chapters in it own nothing.
   */
  const span = (node: Node, previous: Node | undefined, next: Node | undefined) => {
    const start = node.target!.index + (previous && previous.target!.index === node.target!.index ? 1 : 0);
    return Math.max(0, prefix[next ? next.target!.index : weights.length]! - prefix[start]!);
  };

  // Unresolved nodes are replaced by their (resolved) descendants in place.
  const lift = (nodes: readonly Node[]): Node[] =>
    nodes.flatMap((node) => (node.target ? [node] : lift(node.children)));

  let level = lift(tree).sort(compare);
  for (let round = 0; round < MAX_DESCENT; round++) {
    const withChildren = level.filter((node) => placed(walk(node.children)).length > 0);
    if (!withChildren.length) break;
    const positions = new Map(level.map((node, index) => [node, index]));
    const next = (node: Node) => level[positions.get(node)! + 1];
    const owned = (node: Node) => span(node, level[positions.get(node)! - 1], next(node));
    const container = (node: Node) =>
      CONTAINER_LABEL.test(node.label) ||
      // A chapter whose sections are numbered 1, 2, 3 is still a chapter.
      (!isChapterLabel(node.label) && numberedChapters(node.children)) ||
      (total > 0 && owned(node) > total * DOMINANT_SHARE) ||
      owned(node) > VOLUME_WEIGHT;
    const chapterSized = (node: Node) => owned(node) / Math.max(1, lift(node.children).length) >= MIN_CHAPTER_WEIGHT;
    const containers = withChildren.filter((node) => container(node) && chapterSized(node));
    const detached = withChildren.filter((node) => {
      const following = next(node);
      return placed(walk(node.children)).some(
        (child) => compare(child, node) < 0 || (following !== undefined && compare(child, following) >= 0),
      );
    });
    // A level that is mostly containers (volumes of a bundle, parts of a work,
    // a lone root) descends as a whole, so siblings end at one granularity. An
    // outlier — one enormous chapter among ordinary ones — descends alone, as
    // does a subtree that has come apart from its own target.
    const containerLevel = level.length === 1 || containers.length * 2 >= withChildren.length;
    // A lone root always opens: the book is never one chapter. Otherwise only
    // nodes whose children are chapter-sized descend.
    const levelMembers = level.length === 1 ? withChildren : withChildren.filter(chapterSized);
    const descend = new Set([...(containerLevel ? levelMembers : containers), ...detached]);
    if (!descend.size) break;
    level = level
      .flatMap((node) => {
        if (!descend.has(node)) return [node];
        const children = lift(node.children).sort(compare);
        // The container's own target stays a boundary (a title page, a part
        // opener) unless its first chapter begins at the same place. It stays
        // as a leaf: its subtree is now part of the level.
        if (children[0] && place(node) === place(children[0])) return children;
        return [{ ...node, children: [] }, ...children];
      })
      .sort(compare);
  }

  const seen = new Set<string>();
  const chapters = level.filter((node) => !seen.has(place(node)) && !!seen.add(place(node)));
  return { chapters: chapters.map(entry), entries: entries.map(entry) };
}
