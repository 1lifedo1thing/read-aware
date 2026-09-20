import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { extractBookText } from "./book-text-extraction";
import { parseBookTextRecord } from "./book-text-record";

function book(html: string[], toc: FoliateBook["toc"]): FoliateBook {
  return { toc, sections: html.map((text, index) => ({ id: `s${index}.html`, createDocument: async () => new JSDOM(text).window.document })),
    resolveHref: (href: string) => { const [file, id] = href.split("#"); return { index: Number(file[1]),
      anchor: id ? (doc: Document) => doc.getElementById(id) : 0 }; },
  } as FoliateBook;
}
const extract = (source: FoliateBook) => extractBookText(source, { bookId: "b", contentVersion: "sha256:test", prior: null,
  signal: new AbortController().signal, yieldToReader: async () => {}, save: async () => {}, progress: () => {}, warn: () => {} });

test("TOC chapters cut within a file and continue across files, without previous or next chapter text", async () => {
  const record = await extract(book([
    '<p>前言。</p><h1 id="four">第4章</h1><p>第四章正文。</p><h1 id="five">第5章</h1><p>第五章前半。</p>',
    '<p>第五章后半。</p><h1 id="six">第6章</h1><p>第六章正文。</p>',
  ], [{ href: "s0.html#four", label: "第4章" }, { href: "s0.html#five", label: "第5章" }, { href: "s1.html#six", label: "第6章" }]));
  expect(record.chapters.map(c => c.title)).toEqual([undefined, "第4章", "第5章", "第6章"]);
  expect(record.chapters.map(c => c.text)).toEqual(["前言。", "第4章第四章正文。", "第5章第五章前半。 第五章后半。", "第6章第六章正文。"]);
  expect(record.chapters[2]!.hrefs).toEqual(["s0.html#five", "s1.html"]);
  expect(parseBookTextRecord(record, "b", "sha256:test")).not.toBeNull();
  expect(parseBookTextRecord({ ...record, version: 5 }, "b", "sha256:test")).toBeNull();
});

test("href-less volume names disambiguate repeated numbering; nested TOC entries are aliases", async () => {
  const record = await extract(book(['<h1 id="a">一</h1><p id="detail">细节</p><h1 id="b">一</h1><p>下卷内容</p>'], [
    { href: null, label: "上卷", subitems: [{ href: "s0.html#a", label: "第一章", subitems: [{ href: "s0.html#detail", label: "细节" }] }] },
    { href: null, label: "下卷", subitems: [{ href: "s0.html#b", label: "第一章" }] },
  ]));
  expect(record.chapters.map(c => c.title)).toEqual(["上卷 › 第一章", "下卷 › 第一章"]);
  expect(record.chapters[0]!.hrefs).toContain("s0.html#detail");
  expect(record.chapters[0]!.text).not.toContain("下卷内容");
});

test("missing chapter anchors fail preparation instead of publishing a false whole-file chapter", async () => {
  const record = await extract(book(['<p>正文存在，但目录锚点不存在。</p>'], [{ href: "s0.html#missing", label: "第1章" }]));
  expect(record.finalized).toBe(false);
  expect(record.chapters).toEqual([]);
  expect(record.failures).toEqual([{ sectionIndex: 0, code: "library/text-extraction-failed" }]);
});

test("chapter boundaries use the heading block and preserve offsets through whitespace", async () => {
  const record = await extract(book(['<p>前言\n\n结束。</p>\n<h1> <a id="start"></a> 第一章 </h1><p>正文。</p>'], [{ href: "s0.html#start", label: "第一章" }]));
  expect(record.chapters.map(c => c.text)).toEqual(["前言 结束。", "第一章 正文。"]);
});

test("an end-of-file chapter anchor belongs only to the chapter continuing in the next file", async () => {
  const record = await extract(book(['<h1 id="a">A</h1><p>第一章。</p><a id="b"></a>', '<p>第二章续文。</p>'],
    [{ href: "s0.html#a", label: "第一章" }, { href: "s0.html#b", label: "第二章" }]));
  expect(record.chapters.map(c => c.text)).toEqual(["A第一章。", "第二章续文。"]);
  expect(record.chapters[0]!.hrefs).not.toContain("s0.html#b");
  expect(record.chapters[1]!.hrefs).toEqual(["s0.html#b", "s1.html"]);
});
