import { describe, expect, test } from "bun:test";
import { ensureUsableToc } from "./toc-synthesis";

/** The slice of a parsed document `labelFromDocument` reads. */
function fakeDocument(heading: string): Document {
  const el = { textContent: heading };
  return {
    querySelectorAll: (selector: string) => (selector.startsWith("h1") ? [el] : []),
    body: { querySelectorAll: () => [], children: [] },
  } as unknown as Document;
}

function sections(count: number, id: (index: number) => string | number) {
  return Array.from({ length: count }, (_, index) => ({
    id: id(index),
    createDocument: () => fakeDocument(`Chapter ${index}`),
  }));
}

describe("ensureUsableToc with engine-mapped hrefs (MOBI / KF8)", () => {
  /** A KF8-shaped book: numeric section ids, `kindle:pos:` hrefs, and the
   *  engine's own splitter — file-name matching finds nothing here. */
  function kf8Book(tocCount: number, sectionCount: number) {
    const href = (index: number) => `kindle:pos:fid:${index.toString(32).padStart(4, "0")}:off:0000000000`;
    return {
      toc: Array.from({ length: tocCount }, (_, index) => ({ label: `第${index}章`, href: href(index) })),
      sections: sections(sectionCount, (index) => index),
      splitTOCHref: (value: string): [number, null] => {
        const match = /kindle:pos:fid:(\w+):off:/.exec(value);
        return match ? [parseInt(match[1]!, 32), null] : [-1, null];
      },
      getSectionHref: (index: number) => href(index),
    };
  }

  test("a nav that covers the spine through the engine mapping is left alone", async () => {
    const book = kf8Book(9, 10);
    const before = book.toc.map((item) => item.href);
    expect(await ensureUsableToc(book)).toBe(false);
    expect(book.toc.map((item) => item.href)).toEqual(before);
  });

  test("a deficient nav gains entries whose hrefs the engine minted", async () => {
    const book = kf8Book(1, 8);
    expect(await ensureUsableToc(book)).toBe(true);
    const hrefs = book.toc.map((item) => item.href);
    expect(hrefs).toHaveLength(8);
    // Every synthesized entry is a real kindle:pos href — never a bare index.
    expect(hrefs.every((href) => href.startsWith("kindle:pos:fid:"))).toBe(true);
    expect(book.toc[0]?.label).toBe("第0章");
    expect(book.toc[3]?.label).toBe("Chapter 3");
  });

  test("a format with a splitter but no href minting adds nothing rather than junk", async () => {
    const book = { ...kf8Book(1, 8), getSectionHref: undefined };
    expect(await ensureUsableToc(book)).toBe(false);
    expect(book.toc).toHaveLength(1);
  });
});

describe("ensureUsableToc with collapsed targets (a converter that lost its anchors)", () => {
  const posHref = (fid: number) => `kindle:pos:fid:${fid.toString(32).toUpperCase().padStart(4, "0")}:off:0000000000`;
  type Line = string | { link: string };
  const textNode = (text: string) => ({ nodeType: 3, textContent: text });
  const lineNodes = (line: Line) => typeof line === "string" ? [textNode(line)]
    : [{ nodeType: 1, tagName: "a", getAttribute: (name: string) => (name === "href" ? "#x" : null), childNodes: [textNode(line.link)] }];
  /** A leaf block whose lines are joined by `<br>`, as converters set them;
   *  a `{ link }` line is an anchor with an href, as on a contents page. */
  const block = (tagName: string, ...lines: Line[]) => ({
    tagName, textContent: lines.map((line) => (typeof line === "string" ? line : line.link)).join(""), children: [] as unknown[],
    childNodes: lines.flatMap((line, index) => [
      ...(index ? [{ nodeType: 1, tagName: "br", getAttribute: () => null, childNodes: [] }] : []),
      ...lineNodes(line),
    ]),
    matches: (selector: string) => selector.split(",").map((part) => part.trim()).includes(tagName),
  });
  /** The slice of a parsed document the repair reads: body blocks, plus the
   *  heading lookup `labelFromDocument` would use. */
  const docOf = (...blocks: ReturnType<typeof block>[]): Document => ({
    body: { querySelectorAll: () => blocks, children: blocks },
    querySelectorAll: (selector: string) => (selector.startsWith("h1") ? blocks.filter((b) => /^h[1-3]$/.test(b.tagName)) : []),
  }) as unknown as Document;
  const chapter = (number: string, ...title: string[]) => docOf(block("h2", number), ...title.map((line) => block("p", line)));
  const collapsedBook = () => {
    const docs: Document[] = [
      docOf(),
      // The contents page links each chapter, number and title in one paragraph.
      docOf(block("p", "CONTENTS"), block("p", { link: "Introduction: How This Book Came to Be" }),
        block("p", { link: "CHAPTER ONE" }, { link: "Childhood: Abandoned and Chosen" }),
        block("p", { link: "CHAPTER TWO" }, { link: "Odd Couple: The Two Steves" }),
        block("p", { link: "CHAPTER THREE" }, { link: "The Dropout: Turn On, Tune In . . ." })),
      chapter("INTRODUCTION", "How This Book Came to Be", "In the early summer of 2004, I got a phone call."),
      chapter("CHAPTER ONE", "CHILDHOOD", "Abandoned and Chosen"),
      chapter("CHAPTER TWO", "ODD COUPLE", "The Two Steves"),
      chapter("CHAPTER THREE", "THE DROPOUT", "Turn On, Tune In . . ."),
      chapter("Notes"),
      docOf(block("p", "Paul Jobs with Steve, 1956")),
      docOf(block("p", "About the author")),
    ];
    return {
      toc: [
        { label: "Introduction: How This Book Came to Be", href: posHref(0) },
        { label: "CHAPTER ONE", href: posHref(0), subitems: [{ label: "Childhood: Abandoned and Chosen", href: posHref(0) }] },
        { label: "CHAPTER TWO", href: posHref(0), subitems: [{ label: "Odd Couple: The Two Steves", href: posHref(0) }] },
        // A chapter whose nav splits number, title and subtitle into three entries.
        { label: "CHAPTER THREE", href: posHref(0) },
        { label: "The Dropout:", href: posHref(0) },
        { label: "Turn On, Tune In . . .", href: posHref(0) },
        { label: "Not in this book", href: posHref(0) },
        { label: "Notes", href: posHref(6) },
        { label: "Photos", href: posHref(7) },
      ],
      sections: docs.map((doc, index) => ({ id: index, createDocument: () => doc })),
      splitTOCHref: (value: string): [number, null] => {
        const match = /kindle:pos:fid:(\w+):off:/.exec(value);
        return match ? [parseInt(match[1]!, 32), null] : [-1, null];
      },
      getSectionHref: posHref,
    };
  };

  test("entries sharing one target move to the sections that open with their labels, in reading order", async () => {
    const book = collapsedBook();
    expect(await ensureUsableToc(book)).toBe(true);
    expect(book.toc.map((item) => item.href)).toEqual([
      posHref(2), posHref(3), posHref(4), posHref(5), posHref(5), posHref(5), posHref(0), posHref(6), posHref(7),
    ]);
    // A chapter's title line lands with its number; the hierarchy is kept in place.
    expect(book.toc[1]?.subitems?.[0]?.href).toBe(posHref(3));
    expect(book.toc[2]?.subitems?.[0]?.href).toBe(posHref(4));
    // The contents page links every label; it starts no chapter.
    expect(book.toc.some((item) => item.href === posHref(1))).toBe(false);
    // Labels never found keep their href rather than gaining a guess.
    expect(book.toc[6]?.href).toBe(posHref(0));
  });

  test("a plain-text listing of many labels starts no chapter either", async () => {
    const labels = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"];
    const book = {
      ...collapsedBook(),
      toc: labels.map((label) => ({ label: `CHAPTER ${label}`, href: posHref(0) })),
      sections: [docOf(block("p", "Contents"), ...labels.map((label) => block("p", `CHAPTER ${label}`))),
        ...labels.map((label) => chapter(`CHAPTER ${label}`, "A title"))].map((doc, index) => ({ id: index, createDocument: () => doc })),
    };
    expect(await ensureUsableToc(book)).toBe(true);
    expect(book.toc.map((item) => item.href)).toEqual(labels.map((_, index) => posHref(index + 1)));
  });

  test("two entries at one spot are a legitimate nav and stay put", async () => {
    const book = collapsedBook();
    book.toc = [
      { label: "Introduction", href: posHref(2) },
      { label: "Part One", href: posHref(3) },
      { label: "CHAPTER ONE", href: posHref(3) },
      { label: "CHAPTER TWO", href: posHref(4) },
      { label: "CHAPTER THREE", href: posHref(5) },
      { label: "Notes", href: posHref(6) },
      { label: "Photos", href: posHref(7) },
      { label: "About the author", href: posHref(9) },
    ];
    const before = book.toc.map((item) => item.href);
    expect(await ensureUsableToc(book)).toBe(false);
    expect(book.toc.map((item) => item.href)).toEqual(before);
  });

  test("a book too large to synthesize still gets its collapsed entries repaired", async () => {
    const book = collapsedBook();
    const filler = Array.from({ length: 70 }, (_, index) => ({ id: 100 + index, createDocument: () => docOf(block("p", `Page ${index}`)) }));
    book.sections = [...book.sections, ...filler];
    expect(await ensureUsableToc(book)).toBe(true);
    expect(book.toc.map((item) => item.href).slice(0, 3)).toEqual([posHref(2), posHref(3), posHref(4)]);
    expect(book.toc).toHaveLength(9);
  });
});

describe("ensureUsableToc with file-path hrefs (EPUB)", () => {
  test("synthesized entries use the section file path", async () => {
    const book = {
      toc: [{ label: "Cover", href: "text/part0.xhtml#top" }],
      sections: sections(6, (index) => `text/part${index}.xhtml`),
    };
    expect(await ensureUsableToc(book)).toBe(true);
    expect(book.toc.map((item) => item.href)).toEqual([
      "text/part0.xhtml#top",
      ...Array.from({ length: 5 }, (_, index) => `text/part${index + 1}.xhtml`),
    ]);
    expect(book.toc[0]?.label).toBe("Cover");
  });
});
