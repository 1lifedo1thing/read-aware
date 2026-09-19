import type { Book } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";
import type { LoadDetail } from "../../foliate-js/src/renderer";
import { prepareReaderChapterStarts, markReaderChapterStarts } from "../../src/features/reader/lib/reader-document-layout";
import { readingVisibleText } from "../../src/features/reader/lib/reading-visible-text";

type Result = { name: string; passed: boolean; details?: string };

export async function runScrollChapterRegressions(ViewClass: typeof View): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside foreground Tauri");
  const results: Result[] = [];
  const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
  const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
  for (const scenario of ["continuous", "failed-continuation", "resize-during-load", "superseded", "close"] as const) {
    const view = new ViewClass();
    view.style.cssText = "position:fixed;display:block;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    const texts = [
      `<p id="preface">Earlier chapter.</p><h1 id="a">Chapter A</h1><p>${"First source prose. ".repeat(250)}</p><p>First file ending.</p>`,
      `<p>A non-linear footnote file.</p>`,
      `<p id="middle">Middle file beginning.</p><p id="quote">A persistent bookmarked quotation.</p><p>${"Middle source prose. ".repeat(300)}</p>`,
      `<p id="last">Last continuation.</p><p>${"Final source prose. ".repeat(60)}</p><h1 id="b">Chapter B</h1><p>Another chapter.</p>`,
    ];
    const urls = texts.map(text => URL.createObjectURL(new Blob([`<!doctype html><html><body>${text}</body></html>`], { type: "text/html" })));
    const leases = [0, 0, 0, 0], loads = [0, 0, 0, 0];
    let fail = scenario === "failed-continuation";
    let resume: (() => void) | undefined;
    let waiting = false;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const book: Book = {
      sections: urls.map((url, index) => ({ id: String(index), size: 1000, linear: index === 1 ? "no" : "yes",
        load: async () => {
          loads[index]!++;
          if (index === 3 && fail) throw new Error("Expected continuation load failure");
          if (index === 2 && (scenario === "superseded" || scenario === "close" || scenario === "resize-during-load")) { waiting = true; await pending; }
          leases[index]!++;
          return url;
        }, unload: () => { leases[index]!--; },
      })),
      toc: [{ href: "0#preface" }, { href: "0#a" }, { href: "3#b" }],
      resolveHref: href => ({ index: Number(href[0]), anchor: doc => doc.getElementById(href.split("#")[1]!) }),
      splitTOCHref: href => [href[0]!, href.split("#")[1]], getTOCFragment: (doc, id) => doc.getElementById(String(id)),
    };
    try {
      const starts = await prepareReaderChapterStarts(book);
      view.addEventListener("load", event => {
        const { doc, index } = (event as CustomEvent<LoadDetail>).detail;
        markReaderChapterStarts(doc, index, starts);
      });
      await view.open(book);
      const renderer = view.renderer;
      if (!renderer || !("setChapterStarts" in renderer)) throw new Error("Missing paginator");
      renderer.setChapterStarts(starts);
      renderer.setLayoutAttributes({ flow: "scrolled", margin: "40px", "max-inline-size": "900px" });
      renderer.setStyles("body {font:20px/30px serif !important;padding:32px 24px 64px} p,h1 {margin:0 !important}");
      const navigation = view.goTo("0#a");
      if (scenario === "failed-continuation") {
        let rejected = false;
        try { await navigation; } catch { rejected = true; }
        assert(rejected, "A missing continuation was silently reported as a complete chapter");
        fail = false;
        await view.goTo("0#a");
        assert(renderer.getContents().length === 3, "Retry did not reconstruct the complete chapter");
      } else if (scenario === "superseded" || scenario === "close" || scenario === "resize-during-load") {
        for (let i = 0; !waiting && i < 100; i++) await delay(10);
        assert(waiting, "Continuation never started loading");
        if (scenario === "close") await view.close();
        else if (scenario === "resize-during-load") renderer.setLayoutAttributes({ "max-inline-size": "650px", gap: "5%" });
        else await view.goTo("3#b");
        resume?.(); await navigation;
        assert(scenario === "resize-during-load" ? renderer.getContents().length === 3
          && renderer.getContents().every(({ doc }) => doc.defaultView!.getComputedStyle(doc.body).maxWidth === "650px")
          : scenario === "close" ? renderer.getContents().length === 0
          : renderer.getContents().length === 1 && view.lastLocation?.range?.toString().startsWith("Chapter B") === true,
        "An obsolete continuation replaced the current chapter or survived close");
      } else {
        await navigation;
        await Promise.all(renderer.getContents().map(({ doc }) => doc.fonts.ready));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sources = renderer.getContents().sort((a, b) => a.index - b.index);
        assert(sources.map(x => x.index).join() === "0,2,3", "Not all linear chapter sources share the scroll surface");
        const frames = sources.map(({ doc }) => doc.defaultView!.frameElement!.parentElement!);
        const first = frames[0]!.getBoundingClientRect(), middle = frames[1]!.getBoundingClientRect();
        assert(Math.abs(first.bottom - middle.top) < 1, "Source seam contains a gap or overlapping content");
        assert(frames[0]!.style.paddingBottom === "0px" && frames[1]!.style.paddingTop === "0px", "Source seam retained page margins");
        const textEdge = (doc: Document, edge: "first" | "last") => {
          const paragraphs = [...doc.querySelectorAll("p")];
          const paragraph = edge === "first" ? paragraphs[0]! : paragraphs.at(-1)!;
          return doc.defaultView!.frameElement!.getBoundingClientRect().top
            + paragraph.getBoundingClientRect()[edge === "first" ? "top" : "bottom"];
        };
        assert(Math.abs(textEdge(sources[1]!.doc, "first") - textEdge(sources[0]!.doc, "last")) < 1,
          "Internal source body padding leaves an artificial page gap");
        const total = frames.reduce((sum, frame) => sum + frame.getBoundingClientRect().height, 0);
        assert(Math.abs(renderer.viewSize - total) < 1, "Scrollbar extent only describes part of the chapter");
        const scroller = frames[0]!.parentElement!;
        const beforeLoads = loads.join();
        scroller.scrollTop = first.height - 120;
        await delay();
        const visible = readingVisibleText(view).text;
        assert(visible.includes("First file ending.") && visible.includes("Middle file beginning."), `The two source files do not share one viewport: ${visible.slice(0,150)}`);
        assert(renderer.getVisibleRanges().length === 2, "Visible source ranges omit one side of the seam");
        scroller.scrollTop += 260;
        await delay();
        assert(view.lastLocation?.section.current === 2, "Scrolling over the seam did not update the source CFI");
        assert(loads.join() === beforeLoads && sources.every(source => renderer.getContents().some(current => current.doc === source.doc)), "Scrolling across a file boundary reloaded the reader");
        const quote = sources[1]!.doc.getElementById("quote")!;
        const range = quote.ownerDocument.createRange(); range.selectNodeContents(quote);
        const cfi = view.getCFI(2, range);
        await view.goTo("3#b");
        await view.goTo(cfi);
        assert(renderer.getContents().length === 3 && readingVisibleText(view).text.includes("A persistent bookmarked quotation."), "Bookmark restoration lost preceding or following chapter content");
        const restored = renderer.getContents().find(x => x.index === 2)!.doc.getElementById("quote")!;
        const restoredRange = restored.ownerDocument.createRange(); restoredRange.selectNodeContents(restored);
        assert(view.getCFI(2, restoredRange) === cfi, "Joining source views changed stored CFI paths");
        renderer.setStyles("body {font:24px/36px serif !important} p,h1 {margin:0 !important}");
        await delay();
        assert(renderer.getContents().every(({ doc }) => parseFloat(doc.defaultView!.getComputedStyle(doc.body).fontSize) === 24), "Typography changed only one source of the chapter");
        await view.goTo("3#b");
        await renderer.prev();
        assert(renderer.getContents().length === 3 && !readingVisibleText(view).text.includes("Chapter B"), "Previous chapter navigation split the scroll chapter or leaked the next heading");
      }
      assert(loads[1] === 0, "Non-linear notes were inserted into chapter prose");
      await view.close();
      assert(leases.every(count => count === 0), `Source resources leaked or were released twice: ${leases.join()}`);
      results.push({ name: `continuous scroll / ${scenario}`, passed: true });
    } catch (error) { results.push({ name: `continuous scroll / ${scenario}`, passed: false, details: String(error) }); }
    finally { resume?.(); await view.close(); view.remove(); urls.forEach(url => URL.revokeObjectURL(url)); }
  }
  return results;
}
