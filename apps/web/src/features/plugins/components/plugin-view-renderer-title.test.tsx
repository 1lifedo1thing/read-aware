import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginView } from "../lib/plugin-types";
import { PluginViewRenderer } from "./PluginViewRenderer";

test("a root title that repeats the container title is not rendered twice, pushed views keep theirs", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} }, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const detail: PluginView = { kind: "detail", title: "Jumper", content: [{ kind: "text", text: "Pushed body" }] };
  const view: PluginView = { kind: "detail", title: "Jumper", content: [{ kind: "text", text: "Root body" }],
    actions: [{ id: "details", label: "Details", run: () => ({ view: detail }) }] };
  const headings = () => [...dom.window.document.querySelectorAll("p.font-semibold")].map(node => node.textContent);
  try {
    await initI18n("en");
    await act(async () => { root.render(<StrictMode><PluginViewRenderer view={view} containerTitle="Jumper" /></StrictMode>); });
    expect(headings()).toEqual([]);
    expect(dom.window.document.body.textContent).toContain("Root body");
    await act(async () => { root.render(<StrictMode><PluginViewRenderer view={view} containerTitle="Bookmarks" /></StrictMode>); });
    expect(headings()).toEqual(["Jumper"]);
    await act(async () => { root.render(<StrictMode><PluginViewRenderer view={view} containerTitle="Jumper" /></StrictMode>); });
    await act(async () => { [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Details")!.click(); });
    expect(headings()).toEqual(["Jumper"]);
    expect(dom.window.document.querySelector('button[aria-label="Back"]')).not.toBeNull();
    expect(dom.window.document.body.textContent).toContain("Pushed body");
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
