import type { Book } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";
import type { LoadDetail } from "../../foliate-js/src/renderer";
import { markReaderChapterStarts, prepareReaderChapterStarts } from "../../src/features/reader/lib/reader-document-layout";
import { buildReaderContentCss } from "../../src/features/settings/lib/reader-css";
import { DEFAULT_READER_SETTINGS } from "../../src/features/settings/lib/reader-settings";
import { BUILTIN_READER_PALETTES } from "../../src/features/settings/lib/reader-theme";
import { readingVisibleText } from "../../src/features/reader/lib/reading-visible-text";

type Result = { name: string; passed: boolean; details?: string };

export async function runChapterRegressions(ViewClass: typeof View): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside foreground Tauri");
  const results: Result[] = [];
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  for (const direction of ["ltr", "rtl", "vertical-rl"] as const) {
    for (const mode of ["scroll", "paginated-single", "paginated-double"] as const) {
      const name = `${direction}/${mode}: isolated TOC chapters, source continuation, CFI and progress`;
      const view = new ViewClass();
      view.style.cssText = "position:fixed;display:block;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1";
      document.body.append(view);
      const source = (body: string) => URL.createObjectURL(new Blob([
        `<!doctype html><html ${direction === "rtl" ? 'dir="rtl"' : ""}><head><style>body {${direction === "vertical-rl" ? "writing-mode:vertical-rl;" : ""}} h1,p {margin:0}</style></head><body>${body}</body></html>`,
      ], { type: "text/html" }));
      const urls = [
        source(`<h1 id="preface">Preface</h1><p>${"Previous chapter notes. ".repeat(40)}</p><section><h1 id="one">Chapter one</h1><p id="quote">A bookmarked quotation.</p><h2 id="minor">Subsection</h2><p>${"Chapter one prose. ".repeat(100)}</p></section><h1 id="two">Chapter two</h1>`),
        source(`<p id="continuation">Chapter two continues in another source file.</p><p>${"Chapter two prose. ".repeat(30)}</p><h1 id="three">Chapter three</h1><p>The last chapter.</p>`),
      ];
      const book: Book = {
        sections: urls.map((url, index) => ({ id: String(index), size: 1000, load: () => url })),
        toc: [{ href: "0#preface" }, { href: null, subitems: [
          { href: "0#one", subitems: [{ href: "0#minor" }] }, { href: "0#two" }, { href: "1#three" },
        ] }],
        resolveHref: href => ({ index: Number(href[0]), anchor: doc => doc.getElementById(href.split("#")[1]!) }),
        splitTOCHref: href => [href[0]!, href.split("#")[1]],
        getTOCFragment: (doc, fragment) => doc.getElementById(String(fragment)),
      };
      try {
        const starts = await prepareReaderChapterStarts(book);
        let originalCfi = "";
        view.addEventListener("load", event => {
          const { doc, index } = (event as CustomEvent<LoadDetail>).detail;
          const quote = doc.getElementById("quote");
          if (quote) {
            const range = doc.createRange(); range.selectNodeContents(quote);
            originalCfi = view.getCFI(index, range);
          }
          markReaderChapterStarts(doc, index, starts);
        });
        await view.open(book);
        const renderer = view.renderer;
        if (!renderer || !("setChapterStarts" in renderer)) throw new Error("Missing paginator");
        renderer.setChapterStarts(starts);
        renderer.setLayoutAttributes({ flow: mode === "scroll" ? "scrolled" : "paginated", "max-column-count": mode === "paginated-double" ? "2" : "1", "max-inline-size": "700px" });
        renderer.setStyles(buildReaderContentCss({ ...DEFAULT_READER_SETTINGS, fontFamily: "system:serif", readingMode: mode }, { palette: BUILTIN_READER_PALETTES.warm }));
        const settle = async () => {
          await renderer.waitForCurrentRender();
          await renderer.getContents()[0]!.doc.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };
        const text = () => view.lastLocation?.range?.toString().trim() ?? "";
        await view.goTo("0#one"); await settle();
        assert(text().startsWith("Chapter one"), `Chapter one opens in previous content: ${text().slice(0,100)}`);
        const doc = renderer.getContents()[0]!.doc;
        const iframe = doc.defaultView!.frameElement as HTMLIFrameElement;
        assert(iframe.style.clipPath.startsWith("inset("), "Source document was not bounded to the chapter");
        const overlay = renderer.getContents()[0]!.overlayer?.element;
        assert(!!overlay, "Missing annotation layer");
        const frameRect = iframe.getBoundingClientRect(), overlayRect = overlay!.getBoundingClientRect();
        assert(Math.abs(frameRect.left - overlayRect.left) < 1 && Math.abs(frameRect.top - overlayRect.top) < 1,
          `Annotations shifted relative to source text: ${frameRect.left},${frameRect.top} vs ${overlayRect.left},${overlayRect.top}`);
        assert(mode === "scroll" ? renderer.start < 1 : Math.abs(renderer.start - renderer.size) < 1, "TOC chapter is not the start of its reading surface");
        const firstFraction = view.lastLocation?.fraction ?? 0;
        // A bookmark created in the uncut source must still resolve and select
        // the correct chapter after navigating through another source file.
        await view.goTo("1#three"); await settle();
        assert(text().startsWith("Chapter three"), "Next source's chapter opens in its preceding continuation");
        await view.goTo(originalCfi); await settle();
        assert(text().includes("A bookmarked quotation."), "Existing CFI no longer finds its text");
        const quote = renderer.getContents()[0]!.doc.getElementById("quote")!;
        const range = quote.ownerDocument.createRange(); range.selectNodeContents(quote);
        assert(view.getCFI(0, range) === originalCfi, "Chapter presentation changed source CFI paths");
        await view.goTo("0#one");
        // The next chapter must never share the final viewport with this one.
        let steps = 0;
        while (!text().startsWith("Chapter two") && steps++ < 40) {
          assert(!text().includes("Chapter two"), "Chapters share a viewport");
          await renderer.next();
        }
        assert(text().startsWith("Chapter two"), "Sequential reading skipped the next chapter");
        assert((view.lastLocation?.fraction ?? 0) > firstFraction, "Progress reset at an in-file chapter boundary");
        assert(renderer.getContents()[0]?.index === 0, "Chapter title lost its original source index");
        if (mode === "scroll") {
          assert(renderer.getContents().length === 2, "A scroll chapter is still split at the source file boundary");
          const visible = readingVisibleText(view).text;
          assert(visible.includes("Chapter two continues"), "The chapter title and its continuation do not share a viewport");
          assert(!visible.includes("Chapter three"), "Continuous reading crossed a TOC chapter boundary");
          await view.goTo("1#three");
          await renderer.prev(); await settle();
          assert(renderer.getContents().length === 2 && !readingVisibleText(view).text.includes("Chapter three"), "Returning to a chapter lost its continuation");
          await view.goTo("0#two");
        } else {
          await renderer.next(); await settle();
          assert(renderer.getContents()[0]?.index === 1 && text().startsWith("Chapter two continues"), "Cross-file chapter continuation was skipped or a blank step was added");
          await renderer.prev(); await settle();
          assert(renderer.getContents()[0]?.index === 0 && text().startsWith("Chapter two"), "Backwards source crossing mixed chapter one with chapter two");
        }
        await renderer.prev();
        assert(!text().includes("Chapter two") && renderer.getContents()[0]?.index === 0, "Previous chapter turn failed");
        await view.goTo("0#minor"); await settle();
        assert(text().includes("Subsection"), "Nested subsection navigation failed");
        // Resizing and mode changes preserve the active chapter bounds.
        renderer.setLayoutAttributes({ "max-inline-size": "600px", gap: "5%" });
        await settle();
        assert(!text().includes("Previous chapter notes."), "Relayout leaked a preceding chapter");
        await view.goTo("0#one");
        renderer.setAttribute("flow", mode === "scroll" ? "paginated" : "scrolled");
        await settle();
        assert(text().startsWith("Chapter one"), "Changing reading mode lost the chapter boundary");
        renderer.setAttribute("flow", mode === "scroll" ? "scrolled" : "paginated");
        await settle();
        await view.goTo({ index: 0, anchor: 0 });
        assert(text().startsWith("Preface"), "Source fraction 0 no longer selects the first chapter");
        await view.goTo({ index: 0, anchor: 1 });
        assert(mode === "scroll" ? renderer.getContents().length === 2 && !text().includes("Chapter one")
          : text().startsWith("Chapter two"), "Source fraction 1 no longer selects the final chapter");
        results.push({ name, passed: true });
      } catch (error) { results.push({ name, passed: false, details: String(error) }); }
      finally { await view.close(); view.remove(); urls.forEach(url => URL.revokeObjectURL(url)); }
    }
  }
  return results;
}
