import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginListView } from "../lib/plugin-types";
import { PluginListViewBody } from "./PluginListViewBody";
import type { PluginQueryRunner, PluginResultRunner } from "./plugin-view-types";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("a plugin-computed search box sends settled text once, keeps its field while empty, and Enter takes the first row", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { pretendToBeVisual: true });
  // React's input event fallback expects the legacy methods when react-dom is
  // imported before this JSDOM window is installed (see plugin-editor-view.test).
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const sent: string[] = [], selected: string[] = [];
  const onResult: PluginResultRunner = async run => run();
  const onQuery: PluginQueryRunner = async (query, run) => { sent.push(query); await run(); };
  const view = (items: string[]): PluginListView => ({ kind: "list", emptyText: "Nothing matches",
    items: items.map(id => ({ id, title: id, onSelect: () => { selected.push(id); return null; } })),
    search: { placeholder: "Go to", autoFocus: true, onQuery: () => null } });
  const render = (next: PluginListView, searchQuery: string) => act(async () => {
    root.render(<StrictMode><PluginListViewBody view={next} busy={false} onResult={onResult} onQuery={onQuery} searchQuery={searchQuery} /></StrictMode>);
  });
  const input = () => dom.window.document.querySelector<HTMLInputElement>("input[type=search]")!;
  // Under this JSDOM install React watches the focused input through its
  // polyfill (see attachEvent above), which notices value changes on keyup.
  const type = (value: string) => act(async () => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: value.at(-1) ?? "Backspace", bubbles: true }));
  });
  try {
    await initI18n("en");
    await render(view(["Contents"]), "");
    expect(input().placeholder).toBe("Go to");
    expect(dom.window.document.activeElement).toBe(input());
    await type("4"); await type("42");
    await act(async () => { await wait(260); });
    expect(sent).toEqual(["42"]);
    // The answer arrives as new content under the same frame: the field keeps its text and nothing is re-sent.
    await render(view(["Chapter 42", "Page 42"]), "42");
    expect(input().value).toBe("42");
    await act(async () => { await wait(260); });
    expect(sent).toEqual(["42"]);
    await act(async () => { input().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(selected).toEqual(["Chapter 42"]);
    // An empty answer keeps the box and shows the plugin's empty text.
    await render(view([]), "42");
    expect(input().value).toBe("42");
    expect(dom.window.document.body.textContent).toContain("Nothing matches");
    // Clearing sends the empty query exactly once.
    await type("");
    await act(async () => { await wait(260); });
    expect(sent).toEqual(["42", ""]);
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
