import { expect, test } from "bun:test";
import type { TOCItem } from "../foliate-js/src/book";
import { buildChapterMap } from "../foliate-js/src/chapter-map";

/** A book whose hrefs are `s<index>` (section start) or `s<index>#<id>` (an anchor inside it). */
function book(toc: TOCItem[], sections: number | number[]) {
  const sizes = typeof sections === "number" ? Array.from({ length: sections }, () => 1000) : sections;
  return {
    toc,
    sections: sizes.map((size) => ({ size, linear: "yes" })),
    resolveHref: async (href: string) => {
      const [file, id] = href.split("#");
      const index = Number(file!.slice(1));
      if (!Number.isInteger(index) || index >= sizes.length) return null;
      return { index, anchor: id ? (doc: Document) => doc.getElementById(id) : undefined };
    },
  };
}

const item = (label: string, href: string | null, subitems?: TOCItem[]): TOCItem => ({ label, href, subitems });
const titles = async (toc: TOCItem[], sections: number | number[]) =>
  (await buildChapterMap(book(toc, sections))).chapters.map((chapter) => chapter.title);

test("an ordinary TOC keeps its top level as chapters; sections stay inside them", async () => {
  const toc = [
    item("前言", "s0"),
    item("第一章 起源", "s1", [item("1.1 背景", "s1#a"), item("1.2 问题", "s2")]),
    item("第二章 发展", "s3", [item("2.1 过程", "s3#b")]),
  ];
  expect(await titles(toc, 4)).toEqual(["前言", "第一章 起源", "第二章 发展"]);
  const map = await buildChapterMap(book(toc, 4));
  expect(map.entries.map((entry) => entry.href)).toEqual(["s0", "s1", "s1#a", "s2", "s3", "s3#b"]);
});

test("a chapter numbered 1, 2, 3 inside is still one chapter", async () => {
  const toc = [
    item("Chapter 1. Basics", "s0", [item("1 Types", "s0#a"), item("2 Values", "s0#b"), item("3 Scope", "s1")]),
    item("Chapter 2. Functions", "s2", [item("1 Calls", "s2#a"), item("2 Closures", "s2#b"), item("3 Returns", "s3")]),
  ];
  expect(await titles(toc, 4)).toEqual(["Chapter 1. Basics", "Chapter 2. Functions"]);
});

test("a single root is the book: its children are the chapters", async () => {
  // The root and its first volume both open the first file: one place, one chapter.
  const toc = [item("毛选", "s0", [item("第一卷", "s0", [item("第一篇", "s1")]), item("第二卷", "s2")])];
  expect(await titles(toc, 3)).toEqual(["毛选 › 第一卷", "毛选 › 第一卷 › 第一篇", "毛选 › 第二卷"]);
  // A root whose first child is anchored further in keeps the text before it.
  const anchored = [item("Book", "s0", [item("Part 1", "s0#p1", [item("Chapter 1", "s1")])])];
  expect(await titles(anchored, 2)).toEqual(["Book", "Book › Part 1", "Book › Part 1 › Chapter 1"]);
});

test("volumes holding numbered chapters descend as a whole level", async () => {
  const volume = (name: string, start: number) =>
    item(name, `s${start}`, [
      item("第一章", `s${start + 1}`),
      item("第二章", `s${start + 2}`),
      item("第三章", `s${start + 3}`),
    ]);
  const toc = [item("版权信息", "s0"), volume("三体", 1), volume("黑暗森林", 5), item("后记", "s9")];
  expect(await titles(toc, 10)).toEqual([
    "版权信息",
    "三体",
    "三体 › 第一章",
    "三体 › 第二章",
    "三体 › 第三章",
    "黑暗森林",
    "黑暗森林 › 第一章",
    "黑暗森林 › 第二章",
    "黑暗森林 › 第三章",
    "后记",
  ]);
});

test("part labels mark containers even when their chapters are unnumbered", async () => {
  const toc = [
    item("第一部 科学边界", "s0", [item("疯狂年代", "s1"), item("寂静的春天", "s2")]),
    item("第二部 三体", "s3", [item("红岸", "s4")]),
  ];
  expect(await titles(toc, 5)).toEqual([
    "第一部 科学边界",
    "第一部 科学边界 › 疯狂年代",
    "第一部 科学边界 › 寂静的春天",
    "第二部 三体",
    "第二部 三体 › 红岸",
  ]);
});

test("a volume heavier than any chapter descends by weight", async () => {
  const toc = [
    item("Book of Days", "s0", [item("Morning", "s1"), item("Evening", "s2")]),
    item("Book of Nights", "s3", [item("Dusk", "s4"), item("Dawn", "s5")]),
  ];
  expect(await titles(toc, [1000, 300_000, 300_000, 1000, 300_000, 300_000])).toEqual([
    "Book of Days",
    "Book of Days › Morning",
    "Book of Days › Evening",
    "Book of Nights",
    "Book of Nights › Dusk",
    "Book of Nights › Dawn",
  ]);
});

test("one enormous chapter among ordinary ones descends alone", async () => {
  const toc = [
    item("Intro", "s0", [item("Why", "s0#a"), item("How", "s0#b")]),
    item("Reference", "s1", [item("Types", "s1#t"), item("Library", "s2")]),
    item("Outro", "s3", [item("Next", "s3#n"), item("Thanks", "s3#m")]),
  ];
  expect(await titles(toc, [20_000, 350_000, 350_000, 20_000])).toEqual([
    "Intro",
    "Reference",
    "Reference › Types",
    "Reference › Library",
    "Outro",
  ]);
});

test("title pages gathered at the front do not swallow the text that follows them", async () => {
  // A bundle edition: every volume's title page sits at the front, its text later.
  const toc = [
    item("自由及其背叛", "s0", [item("导言", "s3"), item("爱尔维修", "s4")]),
    item("论革命", "s1", [item("革命的意义", "s5"), item("社会问题", "s6")]),
    item("同情的启蒙", "s2", [item("序", "s7"), item("结论", "s8")]),
  ];
  const map = await buildChapterMap(book(toc, 9));
  expect(map.chapters.map((chapter) => [chapter.target.index, chapter.title])).toEqual([
    [0, "自由及其背叛"],
    [1, "论革命"],
    [2, "同情的启蒙"],
    [3, "自由及其背叛 › 导言"],
    [4, "自由及其背叛 › 爱尔维修"],
    [5, "论革命 › 革命的意义"],
    [6, "论革命 › 社会问题"],
    [7, "同情的启蒙 › 序"],
    [8, "同情的启蒙 › 结论"],
  ]);
});

test("a part whose chapter points past the next part is split where the text actually is", async () => {
  const toc = [
    item("Part III", "s0", [item("Chapter 26", "s1"), item("Chapter 27", "s4")]),
    item("Part IV", "s3", [item("Chapter 28", "s5")]),
  ];
  const map = await buildChapterMap(book(toc, 6));
  expect(map.chapters.map((chapter) => [chapter.target.index, chapter.title])).toEqual([
    [0, "Part III"],
    [1, "Part III › Chapter 26"],
    [3, "Part IV"],
    [4, "Part III › Chapter 27"],
    [5, "Part IV › Chapter 28"],
  ]);
});

test("unresolvable entries give way to their children; grouping labels only name them", async () => {
  const toc = [
    item("Broken", "missing", [item("A", "s0"), item("B", "s1")]),
    item("Appendices", null, [item("Index", "s2")]),
  ];
  const map = await buildChapterMap(book(toc, 3));
  expect(map.chapters.map((chapter) => chapter.title)).toEqual(["Broken › A", "Broken › B", "Appendices › Index"]);
  expect(map.chapters.map((chapter) => chapter.depth)).toEqual([2, 2, 1]);
});

test("a book without navigation has no chapters", async () => {
  expect(await buildChapterMap(book([], 3))).toEqual({ chapters: [], entries: [] });
  expect(await buildChapterMap({ toc: [item("A", "s0")], sections: [{ size: 1, linear: "yes" }] })).toEqual({
    chapters: [],
    entries: [],
  });
});

test('sections numbered under an unspaced "Chapter1" label stay inside the chapter', async () => {
  const toc = [
    item("Chapter1 山野，桃树", "s0", [item("1/", "s0#a"), item("2/", "s0#b"), item("3/", "s1")]),
    item("Chapter2 喂，打劫", "s2", [item("1/", "s2#a"), item("2/", "s2#b"), item("3/", "s3")]),
  ];
  expect(await titles(toc, 4)).toEqual(["Chapter1 山野，桃树", "Chapter2 喂，打劫"]);
});

test("the 卷 of a classical text is its chapter, not a container of its poems", async () => {
  const juan = (n: string, start: number) =>
    item(`卷${n}`, `s${start}`, [
      item("古风其一", `s${start}#a`),
      item("古风其二", `s${start}#b`),
      item("古风其三", `s${start + 1}`),
    ]);
  expect(await titles([juan("一", 0), juan("二", 2), juan("三", 4)], 6)).toEqual(["卷一", "卷二", "卷三"]);
});

test("the last chapter of a single-file book does not own the whole file", async () => {
  const toc = [item("One", "s0#one"), item("Two", "s0#two", [item("Minor", "s0#minor")])];
  expect(await titles(toc, [5000])).toEqual(["One", "Two"]);
});
