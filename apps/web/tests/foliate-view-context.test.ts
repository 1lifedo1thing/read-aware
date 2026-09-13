import { expect, test } from "bun:test";
import { withDom } from "./helpers/foliate-dom";
import type { Book, ResolvedNavigation } from "../foliate-js/src/book";
import type { LoadDetail, RelocateDetail } from "../foliate-js/src/renderer";

// Exercise the actual View protocol with a controlled renderer. This does not
// prove browser layout, iframe loading or paint; those have native scenarios.
test("View and fixed layout preserve navigation ownership through delayed feedback and fallback", () => withDom(async window => {
  const globals: Record<string, unknown> = {
    HTMLElement: window.HTMLElement, customElements: window.customElements,
    Event: window.Event, EventTarget: window.EventTarget, CustomEvent: window.CustomEvent,
    AbortController: window.AbortController, AbortSignal: window.AbortSignal,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    CSSStyleSheet: class { replaceSync() {} },
    getComputedStyle: window.getComputedStyle.bind(window),
  };
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  try {
    const { View }: typeof import("../foliate-js/src/view") = await import(new URL("../public/foliate-js/view.js", import.meta.url).href);
    const view = new View(), slow = Promise.withResolvers<ResolvedNavigation>();
    const book: Book = { sections: [0, 1].map(id => ({ id, size: 100, load: () => "" })),
      resolveHref: href => href === "slow" ? slow.promise : undefined };
    await view.open(book);
    try {
      const renderer = view.renderer!;
      const movements: ResolvedNavigation[] = [], loads: LoadDetail[] = [], relocations: RelocateDetail[] = [];
      const doc = new DOMParser().parseFromString("<p>Text</p>", "text/html");
      renderer.goTo = async target => {
        const resolved = await target;
        if (!resolved) return;
        movements.push(resolved);
        renderer.dispatchEvent(new CustomEvent("load", { detail: { doc, index: resolved.index, context: resolved.context } }));
        renderer.dispatchEvent(new CustomEvent("relocate", { detail: { reason: "page", range: null, index: resolved.index, context: resolved.context } }));
      };
      renderer.next = async (_distance, context) => {
        renderer.dispatchEvent(new CustomEvent("relocate", { detail: { reason: "page", range: null, index: 1, context } }));
      };
      view.addEventListener("load", event => loads.push((event as CustomEvent<LoadDetail>).detail));
      view.addEventListener("relocate", event => relocations.push((event as CustomEvent<RelocateDetail>).detail));
      const old = {}, current = {}, step = {}, initial = {};
      const pending = view.goTo("slow", old);
      await view.goTo(1, current); slow.resolve({ index: 0 });
      expect(await pending).toBeUndefined(); expect(movements).toHaveLength(1);
      expect(loads[0]?.context).toBe(current); expect(relocations[0]?.context).toBe(current);
      await view.next(undefined, step); expect(relocations.at(-1)?.context).toBe(step);
      await view.init({ lastLocation: "missing", context: initial });
      expect(movements.at(-1)).toMatchObject({ index: 0 }); expect(movements.at(-1)?.context).toBe(initial);
      expect(view.lastLocation).not.toHaveProperty("context");
      await view.goTo(1); const native = movements.at(-1)?.context;
      expect(native).toBeDefined(); expect(native).not.toBe(initial);
      expect(loads.at(-1)?.context).toBe(native); expect(relocations.at(-1)?.context).toBe(native);
    } finally { await view.close(); }

    // JSDOM does not load iframes inside shadow roots. Supply documents and
    // load events explicitly; test ownership, not native loading or paint.
    const create = document.createElement.bind(document);
    const previousCreate = Object.getOwnPropertyDescriptor(document, "createElement");
    Object.defineProperty(document, "createElement", { configurable: true, value: (tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === "iframe") Object.defineProperties(element, {
        contentDocument: { value: document.implementation.createHTMLDocument("") },
        src: { set() { queueMicrotask(() => element.dispatchEvent(new window.Event("load"))); } },
      });
      return element;
    } });
    const { FixedLayout }: typeof import("../foliate-js/src/fixed-layout") = await import(new URL("../public/foliate-js/fixed-layout.js", import.meta.url).href);
    const fixed = new FixedLayout(), source = Promise.withResolvers<string>();
    Object.defineProperties(fixed, { clientWidth: { value: 400 }, clientHeight: { value: 600 } });
    document.body.append(fixed);
    const first = {}, latest = {}, observed: RelocateDetail[] = [], shown: LoadDetail[] = [], painted: object[] = [];
    let reads = 0;
    try {
      fixed.open({ rendition: { layout: "pre-paginated", spread: "none", viewport: "width=600,height=800" },
        sections: [{ id: 0, size: 100, load: () => { reads++; return source.promise; } },
          { id: 1, size: 100, load: () => ({ src: "about:blank", onZoom: async () => {} }) }] });
      fixed.addEventListener("relocate", event => observed.push((event as CustomEvent<RelocateDetail>).detail));
      fixed.addEventListener("load", event => shown.push((event as CustomEvent<LoadDetail>).detail));
      fixed.addEventListener("rendered", event => painted.push((event as CustomEvent<{ context: object }>).detail.context));
      const old = fixed.goTo({ index: 0, context: first });
      await Bun.sleep(0); expect(reads).toBe(1);
      const replacement = fixed.goTo({ index: 0, context: latest });
      source.resolve("about:blank"); await Promise.all([old, replacement]);
      expect(fixed.index).toBe(0); expect(shown.at(-1)?.context).toBe(latest);
      expect(observed.at(-1)?.context).toBe(latest);
      expect(observed.some(event => event.context === first)).toBe(false);
      expect(shown.some(event => event.context === first)).toBe(false);
      for (const select of [false, true]) {
        const later = Promise.withResolvers<ResolvedNavigation>();
        const pending = select ? fixed.select(later.promise) : fixed.goTo(later.promise);
        await fixed.goTo({ index: 1, context: latest });
        later.resolve({ index: 0, context: first }); await pending;
        expect(fixed.index).toBe(1); expect(observed.at(-1)?.context).toBe(latest);
      }
      const colors = {}, layout = {};
      fixed.setPageColors({ background: "#fff", foreground: "#111" }, colors);
      await fixed.waitForCurrentRender();
      expect(painted.at(-1)).toBe(colors);
      fixed.setLayout("paginated", 1, layout);
      await Bun.sleep(0); await fixed.waitForCurrentRender();
      expect(observed.at(-1)?.context).toBe(layout);
    } finally {
      source.resolve("about:blank"); fixed.destroy(); fixed.remove();
      if (previousCreate) Object.defineProperty(document, "createElement", previousCreate);
      else Reflect.deleteProperty(document, "createElement");
    }

    const { Paginator }: typeof import("../foliate-js/src/paginator") = await import(new URL("../public/foliate-js/paginator.js", import.meta.url).href);
    const paginator = new Paginator(), renders: object[] = [], appearance = {};
    // Verify the real attribute reaction bridge without claiming layout.
    paginator.render = context => { if (context) renders.push(context); };
    try {
      paginator.setLayoutAttributes({ flow: "scrolled", "max-inline-size": "500px", gap: "10%" }, appearance);
      expect(renders).toEqual([appearance]);
      paginator.attributeChangedCallback("flow", null, "scrolled");
      paginator.attributeChangedCallback("max-inline-size", null, "500px");
      paginator.setLayoutAttributes({ flow: "scrolled", "max-inline-size": "500px", gap: "10%" }, {});
      expect(renders).toEqual([appearance]);
      expect(paginator.getAttribute("max-inline-size")).toBe("500px");
    } finally { paginator.destroy(); }
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}));
