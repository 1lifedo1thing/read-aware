import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { extractBookText } from "./book-text-extraction";
import { parseBookTextRecord } from "./book-text-record";
import { buildChapterMap } from "../../../../foliate-js/src/chapter-map";
import { ensureUsableToc, navigationState } from "../../reader/lib/toc-synthesis";

function book(html: string[], toc: FoliateBook["toc"]): FoliateBook {
  return {
    toc,
    sections: html.map((text, index) => ({
      id: `s${index}.html`,
      createDocument: async () => new JSDOM(text).window.document,
    })),
    resolveHref: (href: string) => {
      const [file, id] = href.split("#");
      return { index: Number(file[1]), anchor: id ? (doc: Document) => doc.getElementById(id) : 0 };
    },
  } as FoliateBook;
}
const extract = async (source: FoliateBook) =>
  extractBookText(source, {
    bookId: "b",
    contentVersion: "sha256:test",
    prior: null,
    chapters: await buildChapterMap(source),
    signal: new AbortController().signal,
    yieldToReader: async () => {},
    save: async () => {},
    progress: () => {},
    warn: () => {},
  });

test("TOC chapters cut within a file and continue across files, without previous or next chapter text", async () => {
  const record = await extract(
    book(
      [
        '<p>前言。</p><h1 id="four">第4章</h1><p>第四章正文。</p><h1 id="five">第5章</h1><p>第五章前半。</p>',
        '<p>第五章后半。</p><h1 id="six">第6章</h1><p>第六章正文。</p>',
      ],
      [
        { href: "s0.html#four", label: "第4章" },
        { href: "s0.html#five", label: "第5章" },
        { href: "s1.html#six", label: "第6章" },
      ],
    ),
  );
  expect(record.chapters.map((c) => c.title)).toEqual([undefined, "第4章", "第5章", "第6章"]);
  expect(record.chapters.map((c) => c.text)).toEqual([
    "前言。",
    "第4章第四章正文。",
    "第5章第五章前半。 第五章后半。",
    "第6章第六章正文。",
  ]);
  expect(record.chapters[2]!.hrefs).toEqual(["s0.html#five", "s1.html"]);
  expect(parseBookTextRecord(record, "b", "sha256:test")).not.toBeNull();
  expect(parseBookTextRecord({ ...record, version: 8 }, "b", "sha256:test")).toBeNull();
});

test("href-less volume names disambiguate repeated numbering; nested TOC entries are aliases", async () => {
  const record = await extract(
    book(
      ['<h1 id="a">一</h1><p id="detail">细节</p><h1 id="b">一</h1><p>下卷内容</p>'],
      [
        {
          href: null,
          label: "上卷",
          subitems: [{ href: "s0.html#a", label: "第一章", subitems: [{ href: "s0.html#detail", label: "细节" }] }],
        },
        { href: null, label: "下卷", subitems: [{ href: "s0.html#b", label: "第一章" }] },
      ],
    ),
  );
  expect(record.chapters.map((c) => c.title)).toEqual(["上卷 › 第一章", "下卷 › 第一章"]);
  expect(record.chapters[0]!.hrefs).toContain("s0.html#detail");
  expect(record.chapters[0]!.text).not.toContain("下卷内容");
});

test("missing chapter anchors fail preparation instead of publishing a false whole-file chapter", async () => {
  const record = await extract(
    book(["<p>正文存在，但目录锚点不存在。</p>"], [{ href: "s0.html#missing", label: "第1章" }]),
  );
  expect(record.finalized).toBe(false);
  expect(record.chapters).toEqual([]);
  expect(record.failures).toEqual([{ sectionIndex: 0, code: "library/text-extraction-failed" }]);
});

test("chapter boundaries use the heading block and preserve offsets through whitespace", async () => {
  const record = await extract(
    book(
      ['<p>前言\n\n结束。</p>\n<h1> <a id="start"></a> 第一章 </h1><p>正文。</p>'],
      [{ href: "s0.html#start", label: "第一章" }],
    ),
  );
  expect(record.chapters.map((c) => c.text)).toEqual(["前言 结束。", "第一章 正文。"]);
});

test("an end-of-file chapter anchor belongs only to the chapter continuing in the next file", async () => {
  const record = await extract(
    book(
      ['<h1 id="a">A</h1><p>第一章。</p><a id="b"></a>', "<p>第二章续文。</p>"],
      [
        { href: "s0.html#a", label: "第一章" },
        { href: "s0.html#b", label: "第二章" },
      ],
    ),
  );
  expect(record.chapters.map((c) => c.text)).toEqual(["A第一章。", "第二章续文。"]);
  expect(record.chapters[0]!.hrefs).not.toContain("s0.html#b");
  expect(record.chapters[1]!.hrefs).toEqual(["s0.html#b", "s1.html"]);
});

test("a paged book without an outline recovers chapters and an outline from its page headings", async () => {
  const pages = ["封面", "第 1 章 醒悟\n孰主孰仆。", "继续醒悟。", "12\n第 2 章 现实\n速成绝不可能。"];
  const source = {
    toc: [],
    sections: pages.map((text, index) => ({ id: `page:${index + 1}`, getText: async () => text })),
    resolveHref: (href: string) => ({ index: (JSON.parse(href) as number[])[0]! }),
  } as unknown as FoliateBook;
  const record = await extract(source);
  expect(record.outline).toEqual([
    { label: "第 1 章 醒悟", href: "[1]" },
    { label: "第 2 章 现实", href: "[3]" },
  ]);
  expect(record.chapters.map((chapter) => chapter.title)).toEqual(["Page 1", "第 1 章 醒悟", "第 2 章 现实"]);
  expect(record.chapters[2]!.text).toBe("第 2 章 现实 速成绝不可能。");
  expect(parseBookTextRecord(record, "b", "sha256:test")).not.toBeNull();
  expect(parseBookTextRecord({ ...record, outline: [{ label: 1 }] }, "b", "sha256:test")).toBeNull();
});

test("navigation too large to rebuild at open is rebuilt from the headings read, stored, and cuts the chapters", async () => {
  const files = [
    ["v1.html", "<h1>卷一</h1>"],
    ["v1c1.html", "<h2>第一章</h2><p>一的正文。</p>"],
    ["v1c2.html", '<h2>第二章</h2><p>二的正文。</p><h2 id="three">第三章</h2><p>三的正文。</p>'],
    ["v2.html", "<h1>卷二</h1>"],
    ["v2c1.html", "<h2>第四章</h2><p>四的正文。</p>"],
  ] as const;
  const source = {
    toc: [
      { label: "卷一", href: "v1.html" },
      { label: "卷二", href: "v2.html" },
    ],
    sections: files.map(([id, body]) => ({
      id,
      size: 2_000_000,
      createDocument: async () => new JSDOM(`<html><body>${body}</body></html>`).window.document,
    })),
    getSectionHref: (index: number) => files[index]![0],
    resolveHref: (href: string) => {
      const [file, id] = href.split("#");
      return {
        index: files.findIndex(([name]) => name === file),
        anchor: id ? (doc: Document) => doc.getElementById(id) : 0,
      };
    },
  } as unknown as FoliateBook;
  expect(await ensureUsableToc(source)).toBe(false);
  expect(navigationState(source)).toBe("deferred");
  const record = await extract(source);
  expect(record.outline).toEqual([
    {
      label: "卷一",
      href: "v1.html",
      subitems: [
        { label: "第一章", href: "v1c1.html" },
        { label: "第二章", href: "v1c2.html" },
        { label: "第三章", href: "v1c2.html#three" },
      ],
    },
    { label: "卷二", href: "v2.html", subitems: [{ label: "第四章", href: "v2c1.html" }] },
  ]);
  expect(record.chapters.map((chapter) => [chapter.title, chapter.text])).toEqual([
    ["卷一", "卷一"],
    ["卷一 › 第一章", "第一章一的正文。"],
    ["卷一 › 第二章", "第二章二的正文。"],
    ["卷一 › 第三章", "第三章三的正文。"],
    ["卷二", "卷二"],
    ["卷二 › 第四章", "第四章四的正文。"],
  ]);
  expect(parseBookTextRecord(record, "b", "sha256:test")).not.toBeNull();
});

test("navigation rebuilt as the book opened is stored for the next opening", async () => {
  const pages = [
    "<h1>卷一</h1>",
    "<h2>第一章</h2><p>正文</p>",
    "<h2>第二章</h2><p>正文</p>",
    "<h2>第三章</h2><p>正文</p>",
  ];
  const source = {
    toc: [{ label: "卷一", href: "s0.html" }],
    sections: pages.map((body, index) => ({
      id: `s${index}.html`,
      size: 1_000,
      createDocument: async () => new JSDOM(`<html><body>${body}</body></html>`).window.document,
    })),
    getSectionHref: (index: number) => `s${index}.html`,
    resolveHref: (href: string) => ({ index: Number(href.slice(1).split(".")[0]), anchor: 0 }),
  } as unknown as FoliateBook;
  expect(await ensureUsableToc(source)).toBe(true);
  const record = await extract(source);
  expect(record.outline?.[0]?.subitems?.map((item) => item.label)).toEqual(["第一章", "第二章", "第三章"]);
});
