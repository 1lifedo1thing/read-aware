import { expect, test } from "bun:test";
import { buildVirtualFoliateBook } from "../src/features/reader/lib/virtual-book";
import { captureContentRange, readContentRange, resolveContentCFI } from "../foliate-js/src/content-range";
import { restoreReadingPosition } from "../src/features/reader/lib/restore-reading-position";
import { withDom } from "./helpers/foliate-dom";
import type { FoliateView } from "../src/features/reader/lib/foliate-engine";

const article = { id: "stable-article", title: "Article", html: "<p>Before a preserved passage after</p>" };
const other = { id: "other-article", html: "<p>Other content</p>" };
test("actual DOM CFIs preserve selected annotation text and reading position across article reorder and restart", () => withDom(async () => {
  const before = await buildVirtualFoliateBook({ sections: [article, other] });
  const doc = await before.sections[0]!.createDocument!();
  const range = doc.createRange(); const text = doc.querySelector("p")!.firstChild!;
  range.setStart(text, 9); range.setEnd(text, 26);
  const stored = JSON.parse(JSON.stringify(captureContentRange(before, 0, range)));
  const after = await buildVirtualFoliateBook({ sections: [other, article] });
  const page = await readContentRange(after, stored, { offset: 0, limit: 100, contextChars: 0 }, () => {});
  expect(page.sectionIndex).toBe(1); expect(page.text).toBe("preserved passage");
  expect(page.cfi).not.toBe(stored.cfi);
  const resolved = resolveContentCFI(after, before.sections[0]!.cfi!);
  expect(resolved.index).toBe(1);
  // The restoration helper uses the same resolver rather than the old fraction.
  const calls: unknown[] = [];
  const view = { goTo: async (cfi: string) => { const result = resolveContentCFI(after, cfi); calls.push(result.index); return result; },
    goToFraction: async (fraction: number) => { calls.push(["fraction", fraction]); }, init: async () => { calls.push("start"); } } as unknown as FoliateView;
  await restoreReadingPosition(view, { virtual: true, reset: true, target: stored.cfi, fraction: 0.7 });
  expect(calls).toEqual([1]);
  await restoreReadingPosition(view, { virtual: true, reset: false, target: "epubcfi(/6/2)", fraction: 0.7 });
  expect(calls).toEqual([1, "start"]);
}));

test("changed or deleted articles, anonymous changed editions and legacy ordinals never silently retarget annotations", async () => {
  const before = await buildVirtualFoliateBook({ sections: [article, other] });
  for (const sections of [[other], [{ ...article, html: "<p>Replacement</p>" }, other], [{ ...article, title: "Changed header" }, other]]) {
    const after = await buildVirtualFoliateBook({ sections });
    expect(() => resolveContentCFI(after, before.sections[0]!.cfi!)).toThrow();
    expect(() => resolveContentCFI(after, "epubcfi(/6/2)")).toThrow();
  }
  const anonymous = await buildVirtualFoliateBook({ sections: [{ html: "Same text" }] });
  const changed = await buildVirtualFoliateBook({ title: "changed", sections: [{ html: "Same text" }] });
  expect(() => resolveContentCFI(changed, anonymous.sections[0]!.cfi!)).toThrow();
  await expect(buildVirtualFoliateBook({ sections: [article, article] })).rejects.toMatchObject({ code: "library/content-unavailable" });
});
