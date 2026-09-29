import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { TOCItem } from "../../../../foliate-js/src/book";
import { ensureUsableToc, navigationState } from "./toc-synthesis";

const html = (body: string) => new JSDOM(`<html><body>${body}</body></html>`).window.document;

function sections(count: number, id: (index: number) => string | number) {
  return Array.from({ length: count }, (_, index) => ({
    id: id(index),
    createDocument: () => html(`<h1>Chapter ${index}</h1><p>Text.</p>`),
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
  const lineNodes = (line: Line) =>
    typeof line === "string"
      ? [textNode(line)]
      : [
          {
            nodeType: 1,
            tagName: "a",
            getAttribute: (name: string) => (name === "href" ? "#x" : null),
            childNodes: [textNode(line.link)],
          },
        ];
  /** A leaf block whose lines are joined by `<br>`, as converters set them;
   *  a `{ link }` line is an anchor with an href, as on a contents page. */
  const block = (tagName: string, ...lines: Line[]) => ({
    tagName,
    textContent: lines.map((line) => (typeof line === "string" ? line : line.link)).join(""),
    children: [] as unknown[],
    childNodes: lines.flatMap((line, index) => [
      ...(index ? [{ nodeType: 1, tagName: "br", getAttribute: () => null, childNodes: [] }] : []),
      ...lineNodes(line),
    ]),
    matches: (selector: string) =>
      selector
        .split(",")
        .map((part) => part.trim())
        .includes(tagName),
  });
  /** The slice of a parsed document the repair reads: body blocks, plus the
   *  heading lookup `labelFromDocument` would use. */
  const docOf = (...blocks: ReturnType<typeof block>[]): Document =>
    ({
      body: { querySelectorAll: () => blocks, children: blocks },
      querySelectorAll: (selector: string) =>
        selector.startsWith("h1") ? blocks.filter((b) => /^h[1-3]$/.test(b.tagName)) : [],
    }) as unknown as Document;
  const chapter = (number: string, ...title: string[]) =>
    docOf(block("h2", number), ...title.map((line) => block("p", line)));
  const collapsedBook = () => {
    const docs: Document[] = [
      docOf(),
      // The contents page links each chapter, number and title in one paragraph.
      docOf(
        block("p", "CONTENTS"),
        block("p", { link: "Introduction: How This Book Came to Be" }),
        block("p", { link: "CHAPTER ONE" }, { link: "Childhood: Abandoned and Chosen" }),
        block("p", { link: "CHAPTER TWO" }, { link: "Odd Couple: The Two Steves" }),
        block("p", { link: "CHAPTER THREE" }, { link: "The Dropout: Turn On, Tune In . . ." }),
      ),
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
        {
          label: "CHAPTER ONE",
          href: posHref(0),
          subitems: [{ label: "Childhood: Abandoned and Chosen", href: posHref(0) }],
        },
        {
          label: "CHAPTER TWO",
          href: posHref(0),
          subitems: [{ label: "Odd Couple: The Two Steves", href: posHref(0) }],
        },
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
      posHref(2),
      posHref(3),
      posHref(4),
      posHref(5),
      posHref(5),
      posHref(5),
      posHref(0),
      posHref(6),
      posHref(7),
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
      sections: [
        docOf(block("p", "Contents"), ...labels.map((label) => block("p", `CHAPTER ${label}`))),
        ...labels.map((label) => chapter(`CHAPTER ${label}`, "A title")),
      ].map((doc, index) => ({ id: index, createDocument: () => doc })),
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
    // Too much markup to parse before opening: the nav is not synthesized.
    const filler = Array.from({ length: 70 }, (_, index) => ({
      id: 100 + index,
      size: 200_000,
      createDocument: () => docOf(block("p", `Page ${index}`)),
    }));
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

describe("ensureUsableToc rebuilding navigation from headings", () => {
  /** A 三体-shaped set: volume title pages set in h1, their chapters and parts in h2. */
  const set = () => {
    const files: { id: string; size: number; createDocument: () => Document }[] = [];
    const toc: TOCItem[] = [];
    const add = (id: string, body: string, own?: string) => {
      files.push({ id, size: 2_000, createDocument: () => html(body) });
      if (own) toc.push({ label: own, href: id });
    };
    add("text/title1.xhtml", "<p>书名：三体1</p>");
    add("text/speech.xhtml", "<h1>刘慈欣2018克拉克奖获奖感言</h1><p>感言正文</p>", "刘慈欣2018克拉克奖获奖感言");
    add("text/v1.xhtml", "<h1>三体I</h1>", "三体I");
    for (let n = 1; n <= 30; n++) add(`text/v1c${n}.xhtml`, `<h2>第${n}章</h2><p>正文</p>`);
    add("text/title2.xhtml", "<p>书名：三体2：黑暗森林</p>");
    add("text/v2.xhtml", "<h1>三体II·黑暗森林</h1>", "三体II·黑暗森林");
    for (const part of ["序章", "上部 面壁者", "中部 咒语", "下部 黑暗森林"])
      add(`text/v2-${part}.xhtml`, `<h2>${part}</h2><p>正文</p>`);
    add("text/v3.xhtml", "<h1>三体III·死神永生</h1>", "三体III·死神永生");
    add(
      "text/v3-p1.xhtml",
      '<h2>《时间之外的往事》序言</h2><p>正文</p><h2 id="toc_1">第一部 公元1453年5月</h2><p>正文</p>',
    );
    for (let n = 2; n <= 30; n++) add(`text/v3p${n}.xhtml`, `<h2>第${n}部</h2><p>正文</p>`);
    add("text/ad.xhtml", "<p>认准读客熊猫</p>");
    return { toc, sections: files };
  };

  test("a set whose nav lists only its volumes gets its chapters, nested by heading level", async () => {
    const book = set();
    expect(book.sections.length).toBeGreaterThan(60);
    expect(await ensureUsableToc(book)).toBe(true);
    expect(navigationState(book)).toBe("synthesized");
    expect(book.toc.map((item) => item.label)).toEqual([
      "刘慈欣2018克拉克奖获奖感言",
      "三体I",
      "三体II·黑暗森林",
      "三体III·死神永生",
    ]);
    expect(book.toc[1]!.subitems).toHaveLength(30);
    expect(book.toc[2]!.subitems?.map((item) => item.label)).toEqual([
      "序章",
      "上部 面壁者",
      "中部 咒语",
      "下部 黑暗森林",
    ]);
    // A further heading with an id is its own entry; headingless title and ad pages are not.
    expect(book.toc[3]!.subitems?.slice(0, 2)).toEqual([
      { label: "《时间之外的往事》序言", href: "text/v3-p1.xhtml" },
      { label: "第一部 公元1453年5月", href: "text/v3-p1.xhtml#toc_1" },
    ]);
  });

  test("entries at one heading level stay siblings", async () => {
    const files = ["序", "第一章 开端", "第二章 发展", "第三章 转折", "第四章 结局", "第五章 尾声"].map((label, n) => ({
      id: `text/p${n}.xhtml`,
      size: 1_000,
      createDocument: () => html(`<h1>${label}</h1><p>正文</p>`),
    }));
    const book: { toc: TOCItem[]; sections: typeof files } = {
      toc: [{ label: "第一章 开端", href: "text/p1.xhtml" }],
      sections: files,
    };
    expect(await ensureUsableToc(book)).toBe(true);
    expect(book.toc.map((item) => item.label)).toEqual([
      "序",
      "第一章 开端",
      "第二章 发展",
      "第三章 转折",
      "第四章 结局",
      "第五章 尾声",
    ]);
    expect(book.toc.every((item) => !item.subitems)).toBe(true);
  });

  test("a contents page never names an entry; a book without headings is labeled by opening words", async () => {
    const withHeadings: { toc: TOCItem[]; sections: { id: string; createDocument: () => Document }[] } = {
      toc: [{ label: "Cover", href: "text/p0.xhtml" }],
      sections: [
        { id: "text/p0.xhtml", createDocument: () => html("<p>Cover</p>") },
        {
          id: "text/p1.xhtml",
          createDocument: () => html('<p><a href="p3.xhtml">三体I</a></p><p><a href="p4.xhtml">第一章</a></p>'),
        },
        { id: "text/p2.xhtml", createDocument: () => html("<p>一段没有标题的文字，从这里开始。</p>") },
        { id: "text/p3.xhtml", createDocument: () => html("<h1>三体I</h1>") },
        { id: "text/p4.xhtml", createDocument: () => html("<h2>第一章 科学边界</h2><p>正文</p>") },
      ],
    };
    expect(await ensureUsableToc(withHeadings)).toBe(true);
    expect(withHeadings.toc.map((item) => item.label)).toEqual(["Cover", "三体I"]);
    expect(withHeadings.toc[1]!.subitems?.map((item) => item.label)).toEqual(["第一章 科学边界"]);

    const plain = {
      toc: [{ label: "Cover", href: "text/p0.xhtml" }] as TOCItem[],
      sections: ["Cover", "一段没有标题的文字", "另一段没有标题的文字", "第三段没有标题的文字"].map((text, n) => ({
        id: `text/p${n}.xhtml`,
        createDocument: () => html(`<p>${text}，从这里开始。</p>`),
      })),
    };
    expect(await ensureUsableToc(plain)).toBe(true);
    expect(plain.toc.map((item) => item.label)).toEqual([
      "Cover",
      "一段没有标题的文字，从这里开始。",
      "另一段没有标题的文字，从这里开始。",
      "第三段没有标题的文字，从这里开始。",
    ]);
  });

  test("a book above the dividing line is left to text extraction; stored navigation needs no parsing", async () => {
    const heavy = set();
    for (const section of heavy.sections) section.size = 200_000;
    const before = structuredClone(heavy.toc);
    expect(await ensureUsableToc(heavy)).toBe(false);
    expect(navigationState(heavy)).toBe("deferred");
    expect(heavy.toc).toEqual(before);

    const stored = [{ label: "三体I", href: "text/v1.xhtml", subitems: [{ label: "第1章", href: "text/v1c1.xhtml" }] }];
    const reopened = set();
    reopened.sections = reopened.sections.map((section) => ({
      ...section,
      createDocument: () => {
        throw new Error("a stored navigation must not parse the book");
      },
    }));
    expect(await ensureUsableToc(reopened, { persisted: stored })).toBe(true);
    expect(navigationState(reopened)).toBe("restored");
    expect(reopened.toc).toEqual(stored);
  });
});

test("the book's own entries that each head later ones are its divisions; a cover is not", async () => {
  const doc = (body: string) => () => html(body);
  const volumes = {
    toc: [
      { label: "Cover", href: "text/cover.xhtml" },
      { label: "全集1", href: "text/v1.xhtml" },
      { label: "全集2", href: "text/v2.xhtml" },
    ] as TOCItem[],
    sections: [
      { id: "text/cover.xhtml", createDocument: doc('<p><img src="c.jpg"></p>') },
      { id: "text/v1.xhtml", createDocument: doc("<p>全集（一）</p><p>奏稿之一</p>") },
      { id: "text/v1a.xhtml", createDocument: doc("<h3>001. 谢恩折</h3><p>正文</p>") },
      { id: "text/v1b.xhtml", createDocument: doc("<h3>002. 遵议大礼疏</h3><p>正文</p>") },
      { id: "text/v2.xhtml", createDocument: doc("<p>全集（二）</p>") },
      { id: "text/v2a.xhtml", createDocument: doc("<h3>003. 请旨折</h3><p>正文</p>") },
      { id: "text/v2b.xhtml", createDocument: doc("<h3>004. 附片</h3><p>正文</p>") },
    ],
  };
  expect(await ensureUsableToc(volumes)).toBe(true);
  expect(volumes.toc.map((item) => [item.label, item.subitems?.map((child) => child.label) ?? []])).toEqual([
    ["Cover", []],
    ["全集1", ["001. 谢恩折", "002. 遵议大礼疏"]],
    ["全集2", ["003. 请旨折", "004. 附片"]],
  ]);
});

test("a set without headings nests its divider pages under its volumes and skips its contents pages", async () => {
  const doc = (body: string) => () => html(body);
  const memorial = (title: string) => doc(`<p>${title}</p><p>奏为请旨事。</p><p>正文一段。</p>`);
  const volumes = {
    toc: [
      { label: "全集1", href: "text/v1.xhtml" },
      { label: "全集2", href: "text/v2.xhtml" },
    ] as TOCItem[],
    sections: [
      { id: "text/v1.xhtml", createDocument: doc('<p><img src="v1.jpg"></p>') },
      {
        id: "text/v1toc.xhtml",
        createDocument: doc("<p>目录</p><p>修订再版编校说明</p><p>咸丰元年</p><p>001. 谢恩折正月</p><p>咸丰二年</p>"),
      },
      { id: "text/v1n.xhtml", createDocument: doc("<p>修订再版编校说明</p><p>一、本书为全集。</p>") },
      { id: "text/v1y1.xhtml", createDocument: doc("<p>咸丰元年</p>") },
      { id: "text/v1a.xhtml", createDocument: memorial("001. 谢恩折正月") },
      { id: "text/v1b.xhtml", createDocument: memorial("002. 遵议大礼疏") },
      { id: "text/v1y2.xhtml", createDocument: doc("<p>咸丰二年</p>") },
      { id: "text/v1c.xhtml", createDocument: memorial("003. 请旨折二月") },
      { id: "text/v2.xhtml", createDocument: doc('<p><img src="v2.jpg"></p>') },
      { id: "text/v2y.xhtml", createDocument: doc("<p>咸丰六年</p>") },
      { id: "text/v2a.xhtml", createDocument: memorial("001．军情折正月") },
      { id: "text/v2b.xhtml", createDocument: memorial("002．大捷折正月") },
    ],
  };
  expect(await ensureUsableToc(volumes)).toBe(true);
  const shape = (items: readonly TOCItem[], depth = 0): string[] =>
    items.flatMap((item) => [`${"  ".repeat(depth)}${item.label}`, ...shape(item.subitems ?? [], depth + 1)]);
  expect(shape(volumes.toc)).toEqual([
    "全集1",
    "  修订再版编校说明",
    "  咸丰元年",
    "    001. 谢恩折正月",
    "    002. 遵议大礼疏",
    "  咸丰二年",
    "    003. 请旨折二月",
    "全集2",
    "  咸丰六年",
    "    001．军情折正月",
    "    002．大捷折正月",
  ]);
});

test("a lone one-line page, or a caption, before plain chapters is content, not a divider", async () => {
  const doc = (body: string) => () => html(body);
  const chapter = (id: string, text: string) => ({ id, createDocument: doc(`<p>${text}</p><p>正文。</p>`) });
  const caption = (id: string, text: string) => ({ id, createDocument: doc(`<p><img src="${id}.jpg">${text}</p>`) });
  const book = {
    toc: [{ label: "Cover", href: "text/cover.xhtml" }] as TOCItem[],
    sections: [
      { id: "text/cover.xhtml", createDocument: doc('<p><img src="c.jpg"></p>') },
      { id: "text/dedication.xhtml", createDocument: doc("<p>献给我的母亲</p>") },
      chapter("text/c1.xhtml", "第一章的开头这样写"),
      caption("text/p1.xhtml", "照片中这头牛生于1971年春天，现在不可能还活着了。"),
      chapter("text/c2.xhtml", "第二章的开头这样写"),
      caption("text/p2.xhtml", "这是我们在陕北插队时住过的窑洞，前面是那条小河。"),
      chapter("text/c3.xhtml", "第三章的开头这样写"),
    ],
  };
  expect(await ensureUsableToc(book)).toBe(true);
  expect(book.toc.every((item) => !item.subitems)).toBe(true);
  expect(book.toc).toHaveLength(7);
});
