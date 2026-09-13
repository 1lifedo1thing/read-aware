import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginBookAccess } from "../lib/plugin-types";
import { PluginBookAccessDialog } from "./PluginBookAccessDialog";

test("keeps the access dialog busy while the host publishes the new grant", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const root = createRoot(dom.window.document.getElementById("root")!);
  const pending = Promise.withResolvers<void>();
  let closed = 0;
  const books = [
    { id: "first", title: "First" },
    { id: "second", title: "Second" },
  ];
  const submit = async () => pending.promise;
  const render = (grant: PluginBookAccess) => {
    root.render(
      <StrictMode>
        <PluginBookAccessDialog
          open
          pluginName="Example"
          grant={grant}
          source="user"
          books={books}
          onClose={() => { closed += 1; }}
          onSubmit={submit}
        />
      </StrictMode>,
    );
  };

  try {
    await initI18n("en");
    await act(async () => { render({ mode: "all" }); });
    const buttons = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")];
    const save = () => dom.window.document.querySelector<HTMLButtonElement>("button[aria-busy]")!;
    const cancel = () => buttons().find((button) => button.textContent === "Cancel")!;

    await act(async () => { save().click(); });
    expect(save().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
    expect(save().textContent).toBe("Saving…");

    // updatePluginBookAccess publishes the new grant before its restart has
    // settled. That prop change must not clear the in-flight busy state.
    await act(async () => { render({ mode: "book", bookId: "second" }); });
    expect(save().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
    expect(save().textContent).toBe("Saving…");
    expect(closed).toBe(0);

    await act(async () => { pending.resolve(); await pending.promise; });
    expect(closed).toBe(1);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
