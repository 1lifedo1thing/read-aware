import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginEditorView, PluginViewResult } from "../lib/plugin-types";
import { PluginEditorViewBody } from "./PluginEditorViewBody";
import type { PluginResultRunner } from "./plugin-view-types";

function setTextareaValue(dom: JSDOM, value: string): void {
  const textarea = dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function press(dom: JSDOM, key: string, modifiers: KeyboardEventInit = {}): void {
  const textarea = dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!;
  textarea.focus();
  textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

function installDom() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  // React's input event fallback expects the legacy methods when this test
  // suite imports react-dom before installing its JSDOM window.
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return { dom, saved, restore: () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

test("editor bounds input, preserves in-flight changes/errors, and passes the captured revision", async () => {
  const { dom, saved, restore } = installDom();
  const root = createRoot(dom.window.document.getElementById("root")!);
  const calls: { value: string; revision: string }[] = [];
  let release!: (result: PluginViewResult) => void;
  const onSave: PluginEditorView["onSave"] = (value, revision) => {
    calls.push({ value, revision });
    return new Promise(resolve => { release = resolve; });
  };
  const view: PluginEditorView = {
    kind: "editor",
    label: "Note text",
    value: "Original",
    revision: "opaque:r1",
    maxLength: 20,
    onSave,
  };
  const onResult: PluginResultRunner = async run => run();
  const textarea = () => dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!;
  const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
    .find(candidate => candidate.textContent === label)!;
  try {
    await initI18n("en");
    await act(async () => { root.render(<StrictMode><PluginEditorViewBody view={view} busy={false} onResult={onResult} /></StrictMode>); });
    expect(textarea().maxLength).toBe(20);

    await act(async () => { setTextareaValue(dom, "Submitted"); });
    await act(async () => { button("Submit").click(); await flush(); });
    expect(calls).toEqual([{ value: "Submitted", revision: "opaque:r1" }]);
    expect(button("Submit").disabled).toBe(true);

    // A user can continue editing while a save is in flight. A successful or
    // failed response belongs to the submitted snapshot, never newer input.
    await act(async () => { setTextareaValue(dom, "Newer input"); });
    release({ fieldErrors: { editor: "Conflict" } });
    await act(async () => { await Promise.resolve(); });
    expect(textarea().value).toBe("Newer input");
    expect(dom.window.document.body.textContent).toContain("Conflict");
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    restore();
    // Keep the compiler aware that the saved map belongs to this test's
    // environment, even though restore() owns the actual cleanup.
    void saved;
  }
});

test("editor blocks stale saves, explicitly reloads, and cancel discards without saving", async () => {
  const { dom, restore } = installDom();
  const root = createRoot(dom.window.document.getElementById("root")!);
  const saves: { value: string; revision: string }[] = [];
  const cancelArgs: unknown[][] = [];
  const view = (revision: string, value: string): PluginEditorView => ({
    kind: "editor",
    label: "Note text",
    value,
    revision,
    maxLength: 20,
    onSave: async (next, expectedRevision) => {
      saves.push({ value: next, revision: expectedRevision });
      return saves.length === 1 ? { fieldErrors: { editor: "Conflict" } } : { toast: "Saved" };
    },
    onCancel: (...args) => { cancelArgs.push(args); return { close: true }; },
  });
  let current = view("opaque:r1", "Original");
  const onResult: PluginResultRunner = async run => run();
  const textarea = () => dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!;
  const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
    .find(candidate => candidate.textContent === label)!;
  const render = async () => { await act(async () => {
    root.render(<StrictMode><PluginEditorViewBody view={current} busy={false} onResult={onResult} /></StrictMode>);
  }); };
  try {
    await initI18n("en"); await render();
    await act(async () => { setTextareaValue(dom, "Draft"); });
    await act(async () => { button("Submit").click(); await flush(); });
    expect(textarea().value).toBe("Draft");
    expect(dom.window.document.body.textContent).toContain("Conflict");

    current = view("opaque:r2", "Remote");
    await render();
    expect(textarea().value).toBe("Draft");
    expect(dom.window.document.body.textContent).toContain("This text changed elsewhere");
    expect(button("Submit").disabled).toBe(true);

    await act(async () => { button("Reload").click(); });
    expect(textarea().value).toBe("Remote");
    await act(async () => { setTextareaValue(dom, "Saved"); });
    await act(async () => { button("Submit").click(); await Promise.resolve(); });
    expect(saves).toEqual([
      { value: "Draft", revision: "opaque:r1" },
      { value: "Saved", revision: "opaque:r2" },
    ]);

    await act(async () => { setTextareaValue(dom, "Discard me"); });
    await act(async () => { button("Cancel").click(); await Promise.resolve(); });
    expect(cancelArgs).toEqual([[]]);
    expect(saves).toHaveLength(2);
    expect(textarea().value).toBe("Remote");

    // The same actions are available from the keyboard and remain bounded.
    await act(async () => { setTextareaValue(dom, "Keyboard"); });
    await render();
    expect(textarea().value).toBe("Keyboard");
    expect(button("Submit").disabled).toBe(false);
    await act(async () => { press(dom, "Enter", { ctrlKey: true }); await flush(); });
    expect(saves.at(-1)).toEqual({ value: "Keyboard", revision: "opaque:r2" });
    await act(async () => { setTextareaValue(dom, "Escape draft"); });
    await act(async () => { press(dom, "Escape"); await flush(); });
    expect(cancelArgs).toEqual([[], []]);
    expect(textarea().value).toBe("Remote");
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close(); restore();
  }
});

for (const timing of ["before", "after", "external"] as const) {
  test(`successful save reconciles source revision ${timing} completion without losing newer input`, async () => {
    const { dom, restore } = installDom();
    const root = createRoot(dom.window.document.getElementById("root")!);
    let release!: (result: PluginViewResult) => void;
    const calls: { value: string; revision: string }[] = [];
    const onSave: PluginEditorView["onSave"] = (value, revision) => {
      calls.push({ value, revision });
      return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : { toast: "Saved" };
    };
    let view: PluginEditorView = { kind: "editor", label: "Note", value: "Original", revision: "r1", maxLength: 100, onSave };
    const onResult: PluginResultRunner = async run => run();
    const render = async () => { await act(async () => {
      root.render(<StrictMode><PluginEditorViewBody view={view} busy={false} onResult={onResult} /></StrictMode>);
    }); };
    const submit = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Submit")!;
    const refreshSource = async () => {
      view = { ...view, value: timing === "external" ? "External change" : "Submitted", revision: "r2" };
      await render();
    };
    try {
      await initI18n("en"); await render();
      await act(async () => { setTextareaValue(dom, "Submitted"); });
      await act(async () => { submit().click(); await flush(); });
      await act(async () => { setTextareaValue(dom, "Newer unsaved input"); });
      if (timing !== "after") await refreshSource();
      await act(async () => { release({ toast: "Saved" }); await flush(); });
      if (timing === "after") await refreshSource();
      expect(dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Newer unsaved input");
      expect(submit().disabled).toBe(timing === "external");
      if (timing !== "external") {
        expect(dom.window.document.body.textContent).not.toContain("This text changed elsewhere");
        await act(async () => { submit().click(); await flush(); });
        expect(calls.at(-1)).toEqual({ value: "Newer unsaved input", revision: "r2" });
      }
    } finally {
      await act(async () => { root.unmount(); }); dom.window.close(); restore();
    }
  });
}
