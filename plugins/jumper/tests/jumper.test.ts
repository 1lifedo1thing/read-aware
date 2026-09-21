import { expect, test } from "bun:test";
import type { BookTocEntry, PluginListView, PluginView, PluginViewResult, PluginViewUpdate, ReadingLocation } from "@read-aware/plugin-types";
import { chapterNumber, findChapters } from "../src/chapters";
import { jumperView } from "../src/views";
import type { JumperContext } from "../src/types";
import { textSearchView } from "../src/text-search";

const location: ReadingLocation = { bookId: "book", contentVersion: "v1", href: "chapter-12" };
const entries: BookTocEntry[] = [
  { id: "part", label: "Part One", ordinal: 1, sectionIndex: null, location: null, children: [
    { id: "chapter", label: "第十二章 起点", ordinal: 2, sectionIndex: 0, location, children: [] },
  ] },
  { id: "other", label: "Chapter 20", ordinal: 3, sectionIndex: 1, location: { ...location, href: "chapter-20" }, children: [] },
];

test("printed chapters, titles and TOC ordinals are not conflated", () => {
  expect(findChapters(entries, "12", "chapter").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "十二", "chapter").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "2", "chapter")).toEqual([]);
  expect(findChapters(entries, "2", "ordinal").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "起点", "chapter").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "20", "chapter").map(entry => entry.id)).toEqual(["other"]);
  expect(chapterNumber("１００")).toBe(100);
  expect(chapterNumber("一百零二")).toBe(102);
  expect(chapterNumber("两千零一")).toBe(2001);
  expect(chapterNumber("0")).toBeNull();
});

function fixture() {
  const jumps: ReadingLocation[] = [];
  const updates: PluginViewUpdate[] = [];
  const ctx = { locale: "zh-Hans", services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => {
    updates.push(update); return { status: "applied" };
  } } }, domains: {
    library: { queries: { books: { getNavigationToc: async () => ({ bookId: "book", contentVersion: "v1", entries }),
      searchLocations: async () => ({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 }),
      listNavigationTargets: async () => ({ bookId: "book", contentVersion: "v1", kind: "pages", status: "absent", items: [], total: 0, nextOffset: null }),
    } } },
    reading: { queries: { session: async () => ({ bookId: "book", sessionId: "session", history: { canGoBack: true, canGoForward: true } }) },
      commands: { goTo: async (target: ReadingLocation) => { jumps.push(target); } },
    },
  } } as unknown as JumperContext;
  return { ctx, jumps, updates };
}
async function mount(view: PluginView, id = "channel") {
  const subscription = await view.live!.subscribe({ id });
  await Bun.sleep(0);
  return subscription;
}
async function box(ctx: JumperContext): Promise<PluginListView> {
  const view = await jumperView(ctx);
  if (view.kind !== "list" || !view.search) throw new Error("Expected the go-to list");
  return view;
}
async function answer(ctx: JumperContext, query: string): Promise<PluginListView> {
  return list(await (await box(ctx)).search!.onQuery(query));
}
function list(result: PluginViewResult): PluginListView {
  if (!result || result.view?.kind !== "list") throw new Error("Expected list result");
  return result.view;
}

test("an empty box lists the whole table of contents, marks the current chapter and keeps unplaced headings inert", async () => {
  const { ctx, jumps } = fixture();
  ctx.domains.reading.queries.session = async () => ({ bookId: "book", sessionId: "session", location: { ...location, href: "chapter-12#p3" },
    history: { canGoBack: false, canGoForward: true } }) as never;
  const view = await box(ctx);
  expect(view.search).toMatchObject({ placeholder: "章节、页码或要查找的文字", autoFocus: true });
  expect(view.items.map(item => [item.id, item.title, item.subtitle, item.onSelect !== undefined])).toEqual([
    ["chapter:part", "Part One", "此目录标题没有可跳转的位置。", false],
    ["chapter:chapter", "第十二章 起点", "Part One", true],
    ["chapter:other", "Chapter 20", undefined, true],
  ]);
  expect(view.items.map(item => item.accessories?.[0])).toEqual([undefined, { kind: "tag", text: "当前" }, undefined]);
  expect(view.actions!.map(action => [action.id, action.disabled])).toEqual([["back", true], ["forward", false]]);
  expect(await view.items[1]!.onSelect!()).toEqual({ close: true });
  expect(jumps).toEqual([location]);
});

test("typed text answers with matching chapters first and the text search last; Enter order is that order", async () => {
  const { ctx, jumps } = fixture();
  const twelve = await answer(ctx, "12");
  expect(twelve.items.map(item => item.id)).toEqual(["chapter:chapter", "search"]);
  expect(twelve.items[1]!.title).toBe("在正文中搜索“12”");
  const title = await answer(ctx, "起点");
  expect(title.items.map(item => item.id)).toEqual(["chapter:chapter", "search"]);
  const missing = await answer(ctx, "99");
  expect(missing.items.map(item => item.id)).toEqual(["search"]);
  expect(jumps).toHaveLength(0);
  expect(await twelve.items[0]!.onSelect!()).toEqual({ close: true });
  expect(jumps).toEqual([location]);
});

test("a unique chapter awaits actual navigation before closing", async () => {
  const { ctx } = fixture();
  ctx.domains.reading.commands.goTo = async () => { throw new Error("engine failure"); };
  await expect((await answer(ctx, "12")).items[0]!.onSelect!()).rejects.toThrow("engine failure");
});

test("the text-search row keeps the typed query and applies smart case", async () => {
  const { ctx } = fixture();
  const requests: unknown[] = [];
  ctx.domains.library.queries.books.searchLocations = async input => {
    requests.push(input);
    return { bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 };
  };
  for (const query of ["needle", "Needle"]) {
    const items = (await answer(ctx, query)).items;
    const result = await items[items.length - 1]!.onSelect!();
    expect(result!.navigation).toBeUndefined();
    await mount(result!.view!, query);
  }
  expect(requests).toEqual([
    { bookId: "book", query: "needle", matchCase: false, limit: 20 },
    { bookId: "book", query: "Needle", matchCase: true, limit: 20 },
  ]);
});

test("back and forward retain the session guard without creating plugin-owned history", async () => {
  const { ctx } = fixture();
  const guards: unknown[] = [];
  ctx.domains.reading.commands.back = async guard => { guards.push(guard); return { status: "completed", sessionId: "session", location }; };
  const view = await box(ctx);
  expect(await view.actions!.find(action => action.id === "back")!.run()).toEqual({ close: true });
  expect(guards).toEqual([{ sessionId: "session" }]);
});

test("printed page labels resolve through navigation targets between chapters and the text search", async () => {
  const { ctx, jumps } = fixture();
  const requests: unknown[] = [];
  const target = (index: number, label: string, href: string) => ({ index, sectionIndex: 0, label, labelTruncated: false, linear: true, location: { ...location, href } });
  const pages = new Map<string, { status: "available" | "absent"; items: ReturnType<typeof target>[] }>([
    ["7", { status: "available", items: [target(6, "7", "page-7")] }],
    ["9", { status: "available", items: [target(8, "9", "page-9a"), target(9, "9", "page-9b")] }],
    ["12", { status: "available", items: [target(11, "12", "page-12")] }],
  ]);
  ctx.domains.library.queries.books.listNavigationTargets = (async (input: { label: string }) => {
    requests.push(input);
    return pages.get(input.label) ?? { status: "absent", items: [] };
  }) as never;
  const seven = await answer(ctx, "7");
  expect(seven.items.map(item => [item.id, item.title])).toEqual([["page:6", "第 7 页"], ["search", "在正文中搜索“7”"]]);
  expect(await seven.items[0]!.onSelect!()).toEqual({ close: true });
  const nine = await answer(ctx, "9");
  expect(nine.items.map(item => item.id)).toEqual(["page:8", "page:9", "search"]);
  await nine.items[1]!.onSelect!();
  expect(jumps.map(jump => jump.href)).toEqual(["page-7", "page-9b"]);
  expect((await answer(ctx, "12")).items.map(item => item.id)).toEqual(["chapter:chapter", "page:11", "search"]);
  expect((await answer(ctx, "none")).items.map(item => item.id)).toEqual(["search"]);
  expect(requests).toEqual(expect.arrayContaining([{ bookId: "book", contentVersion: "v1", kind: "pages", label: "7", limit: 10 }]));
  expect(requests).toHaveLength(4);
  expect((await answer(ctx, "two words")).items.map(item => item.id)).toEqual(["search"]);
  expect(requests).toHaveLength(4);
});

test("a failing page catalog loses only its rows", async () => {
  const { ctx } = fixture();
  ctx.domains.library.queries.books.listNavigationTargets = (async () => { throw Object.assign(new Error("private"), { code: "db/locked" }); }) as never;
  const warn = console.warn; const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try { expect((await answer(ctx, "12")).items.map(item => item.id)).toEqual(["chapter:chapter", "search"]); }
  finally { console.warn = warn; }
  expect(warnings).toHaveLength(1);
});

test("empty paged searches consume continuation and retain the pinned revision", async () => {
  const { ctx, updates } = fixture();
  const requests: unknown[] = [];
  ctx.domains.library.queries.books.searchLocations = async input => {
    requests.push(input);
    return input.cursor
      ? { bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 2, totalSections: 2 }
      : { bookId: "book", contentVersion: "v1", hits: [], nextCursor: "next", textStatus: "partial", scannedSections: 1, totalSections: 2 };
  };
  const rows = (await answer(ctx, "needle")).items;
  const task = (await rows[rows.length - 1]!.onSelect!())!.view!;
  expect(task).toMatchObject({ kind: "blocks", blocks: [{ kind: "progress", value: null }] });
  await mount(task);
  const result = list({ view: updates[updates.length - 1]!.view });
  expect(result.emptyText).toBe("没有匹配结果。");
  expect(requests).toEqual([
    { bookId: "book", query: "needle", matchCase: false, limit: 20 },
    { bookId: "book", query: "needle", matchCase: false, limit: 20, cursor: "next", contentVersion: "v1" },
  ]);
  expect(updates.some(update => update.view.kind === "blocks" && update.view.blocks[0]?.kind === "progress"
    && update.view.blocks[0].value === 1)).toBe(true);
});

test("cancel stops only the current query and ignores a late successful reply", async () => {
  const { ctx, updates } = fixture();
  const calls: Array<{ signal: AbortSignal; resolve: (page: Awaited<ReturnType<typeof ctx.domains.library.queries.books.searchLocations>>) => void }> = [];
  ctx.domains.library.queries.books.searchLocations = (_input, options) => new Promise(resolve => calls.push({ signal: options!.signal!, resolve }));
  const first = textSearchView(ctx, { bookId: "book", query: "first" });
  const sibling = textSearchView(ctx, { bookId: "book", query: "sibling" });
  expect(calls).toHaveLength(0);
  await mount(first);
  const siblingSubscription = await mount(sibling, "sibling");
  expect(calls).toHaveLength(2);
  if (first.kind !== "blocks" || first.blocks[0].kind !== "progress") throw new Error("Expected progress");
  await first.blocks[0].cancel!.run();
  expect(calls[0].signal.aborted).toBe(true);
  expect(calls[1].signal.aborted).toBe(false);
  expect(updates[updates.length - 1]!.view).toMatchObject({ kind: "list", emptyText: "搜索已取消。" });
  const count = updates.length;
  calls[0].resolve({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 });
  await Bun.sleep(0);
  expect(updates).toHaveLength(count);
  siblingSubscription.dispose();
  calls[1].resolve({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 });
  await Bun.sleep(0);
});

test("hiding or closing a pending search cancels it; restoring the frame never restarts it", async () => {
  const { ctx, updates } = fixture();
  let signal: AbortSignal | undefined, calls = 0;
  ctx.domains.library.queries.books.searchLocations = (_input, options) => {
    calls++; signal = options!.signal;
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  };
  const view = textSearchView(ctx, { bookId: "book", query: "needle" });
  const old = await mount(view);
  const replacement = await mount(view, "replacement");
  old.dispose();
  expect(signal!.aborted).toBe(false);
  replacement.dispose();
  expect(signal!.aborted).toBe(true);
  await mount(view, "restored");
  expect(calls).toBe(1);
  expect(updates[updates.length - 1]!.view).toMatchObject({ emptyText: "搜索已取消。" });
  const unmounted = textSearchView(ctx, { bookId: "book", query: "never" });
  await unmounted.onClose!({ reason: "closed" });
  await mount(unmounted, "closed");
  expect(calls).toBe(1);
});

test("failed searches show a host error code and retry uses a fresh signal and the same input", async () => {
  const { ctx, updates } = fixture();
  const inputs: unknown[] = [], signals: AbortSignal[] = [];
  ctx.domains.library.queries.books.searchLocations = async (input, options) => {
    inputs.push(input); signals.push(options!.signal!);
    throw Object.assign(new Error("private details"), { code: "db/locked" });
  };
  const input = { bookId: "book", query: "needle", cursor: "cursor", contentVersion: "v1", matchCase: true };
  await mount(textSearchView(ctx, input));
  const error = updates[updates.length - 1]!.view;
  expect(error).toMatchObject({ kind: "blocks", blocks: [{ kind: "error", code: "db/locked" }, { kind: "actions" }] });
  expect(JSON.stringify(error)).not.toContain("private details");
  if (error.kind !== "blocks" || error.blocks[1].kind !== "actions") throw new Error("Expected retry");
  const retry = await error.blocks[1].actions[0].run();
  expect(retry!.navigation).toBe("replace");
  await mount(retry!.view!, "retry");
  expect(inputs).toEqual([{ ...input, limit: 50 }, { ...input, limit: 50 }]);
  expect(signals[0]).not.toBe(signals[1]);
});

test("completed text matches retain their versioned location and do not search again when restored", async () => {
  const { ctx, updates, jumps } = fixture();
  let calls = 0;
  ctx.domains.library.queries.books.searchLocations = async () => {
    calls++;
    return { bookId: "book", contentVersion: "v1", hits: [{ id: "hit", sectionIndex: 0, location,
      range: { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2/1:0)" },
      excerpt: { pre: "before ", match: "needle", post: " after" } }],
      nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 };
  };
  const view = textSearchView(ctx, { bookId: "book", query: "needle" });
  const subscription = await mount(view);
  subscription.dispose();
  await mount(view, "restored");
  expect(calls).toBe(1);
  const result = list({ view: updates[updates.length - 1]!.view });
  expect(result.items[0].title).toBe("before needle after");
  expect(await result.items[0].onSelect!()).toEqual({ close: true });
  expect(jumps).toEqual([location]);
});

test("stale locations discard hits and do not offer a guaranteed-failing retry of the same cursor", async () => {
  const { ctx, updates } = fixture();
  ctx.domains.library.queries.books.searchLocations = async () => { throw { code: "reader/stale-location" }; };
  await mount(textSearchView(ctx, { bookId: "book", query: "needle", cursor: "old" }));
  expect(updates[updates.length - 1]!.view).toMatchObject({ kind: "list", items: [], emptyText: "书籍内容已变化，请重新搜索。", actions: [] });
});

