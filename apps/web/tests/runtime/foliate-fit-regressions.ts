import type { Book } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";
import { rendererOf } from "./runtime-assertions";

type Result = { name: string; passed: boolean; details?: string };

/** Publisher layouts that break out of the text column (see foliate-js paginator-fit.ts). */
export async function runFitRegressions(ViewClass: typeof View): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside foreground Tauri");
  const results: Result[] = [];
  const assert = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
  };
  const settle = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const open = async (markup: string, flow: "paginated" | "scrolled") => {
    const view = new ViewClass();
    view.style.cssText =
      "position:fixed;display:block;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    const url = URL.createObjectURL(new Blob([markup], { type: "text/html" }));
    const book: Book = { sections: [{ id: "s", size: 1000, load: () => url }] };
    await view.open(book);
    const renderer = rendererOf(view);
    if (!("setLayoutAttributes" in renderer)) throw new Error("Missing paginator");
    renderer.setLayoutAttributes({ flow, "max-column-count": "2", "max-inline-size": "560px" });
    await view.goTo(0);
    const doc = renderer.getContents()[0]!.doc;
    await settle();
    return {
      doc,
      /** Widest fragment of the element, against the width the body gives its content. */
      fits: (selector: string) => {
        const element = doc.querySelector(selector)!;
        const style = doc.defaultView!.getComputedStyle(doc.body);
        const limit =
          doc.body.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
        let width = 0;
        for (const rect of element.getClientRects()) width = Math.max(width, rect.width);
        return { width: Math.round(width), limit: Math.round(limit), ok: width <= limit + 2 };
      },
      close: async () => {
        await view.close();
        view.remove();
        URL.revokeObjectURL(url);
      },
    };
  };

  const pixel =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#345"/></svg>',
    );
  const cases: { name: string; markup: string; check(page: Awaited<ReturnType<typeof open>>): void }[] = [
    {
      name: "a cover page whose body is positioned out of flow still shows its image",
      markup: `<!doctype html><html><head><style>body{display:table;position:absolute;margin:0;height:100%;width:100%}#Cover{display:table-cell;vertical-align:middle;text-align:center}img{height:90vh}</style></head><body><div id="Cover"><img src="${pixel}"></div></body></html>`,
      check: ({ doc }) => {
        assert(doc.defaultView!.getComputedStyle(doc.body).position === "static", "Body stayed out of flow");
        const image = doc.querySelector("img")!.getBoundingClientRect();
        assert(image.width > 50 && image.height > 50, `Cover image collapsed: ${image.width}×${image.height}`);
        assert(image.left >= 0 && image.left < 1200, `Cover image is off the page at x=${Math.round(image.left)}`);
      },
    },
    {
      name: "long code lines wrap inside the column",
      markup: `<!doctype html><html><head><style>pre code{white-space:pre}</style></head><body><p>Intro.</p><pre><code id="code">${"std::unique_ptr&lt;int&gt; pointer = std::make_unique&lt;int&gt;(10); ".repeat(4)}</code></pre></body></html>`,
      check: ({ fits }) => {
        const { width, limit, ok } = fits("#code");
        assert(ok, `Code is ${width}px wide in a ${limit}px column`);
      },
    },
    {
      name: "a table wider than the column is scaled to it",
      markup: `<!doctype html><html><body><table id="table" style="width:720px"><tr>${"<td>cell</td>".repeat(6)}</tr></table></body></html>`,
      check: ({ doc, fits }) => {
        assert(doc.querySelector("#table")!.getAttribute("data-foliate-fit") === "zoom", "Table was not scaled");
        const { width, limit, ok } = fits("#table");
        assert(ok, `Table is ${width}px wide in a ${limit}px column`);
      },
    },
    {
      name: "a table far wider than the column scrolls instead of shrinking to illegibility",
      markup: `<!doctype html><html><body><table id="table" style="width:3000px"><tr>${"<td>cell</td>".repeat(20)}</tr></table></body></html>`,
      check: ({ doc, fits }) => {
        assert(doc.querySelector("#table")!.getAttribute("data-foliate-fit") === "scroll", "Table was not scrolled");
        assert(fits("#table").ok, "Scrolling table still overflows the column");
      },
    },
    {
      name: "fixed-width blocks and nowrap text stay inside the column",
      markup: `<!doctype html><html><body><div id="block" style="width:2400px">中信出版集团</div><p id="nowrap" style="white-space:nowrap">${"不换行的一整行文字".repeat(12)}</p></body></html>`,
      check: ({ fits }) => {
        for (const selector of ["#block", "#nowrap"]) {
          const { width, limit, ok } = fits(selector);
          assert(ok, `${selector} is ${width}px wide in a ${limit}px column`);
        }
      },
    },
    {
      name: "an absolutely positioned block sized to the viewport returns to the column",
      markup: `<!doctype html><html><body><h1>多维度的日本</h1><div id="publisher" style="position:absolute;left:0;right:0;bottom:2em;text-align:right">中信出版集团</div></body></html>`,
      check: ({ doc, fits }) => {
        const { width, limit, ok } = fits("#publisher");
        assert(ok, `Publisher line is ${width}px wide in a ${limit}px column`);
        assert(
          doc.defaultView!.getComputedStyle(doc.querySelector("#publisher")!).position === "static",
          "Still out of flow",
        );
      },
    },
    {
      name: "content that already fits is left alone",
      markup: `<!doctype html><html><body><pre id="pre">short line</pre><table id="table"><tr><td>a</td></tr></table><p>Text.</p></body></html>`,
      check: ({ doc }) => {
        assert(!doc.querySelector("[data-foliate-fit]"), "A fitting element was marked");
      },
    },
  ];
  for (const flow of ["paginated", "scrolled"] as const)
    for (const { name, markup, check } of cases) {
      let page: Awaited<ReturnType<typeof open>> | undefined;
      try {
        page = await open(markup, flow);
        check(page);
        results.push({ name: `${flow}: ${name}`, passed: true });
      } catch (error) {
        results.push({ name: `${flow}: ${name}`, passed: false, details: String(error) });
      } finally {
        await page?.close();
      }
    }
  return results;
}
