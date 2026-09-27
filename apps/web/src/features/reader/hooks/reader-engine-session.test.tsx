import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useEffectEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReadingMode } from "../../settings/lib/reader-settings";
import type { ReaderEngineSession } from "../lib/reader-engine-session";
import { useReaderEngineSession } from "./useReaderEngineSession";

type Source = { name: string };
type Log = { opened: string[]; closed: string[]; handled: string[] };

let dom: JSDOM;
let root: Root;
let restore: Array<[string, PropertyDescriptor | undefined]> = [];

beforeEach(() => {
  dom = new JSDOM("<div id='root'></div><div id='section'></div>");
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  restore = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  dom.window.close();
  for (const [key, value] of restore) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
});

/**
 * Stands in for FoliateReaderView: every render hands the hook fresh
 * callbacks (the identities that used to re-open the book), and the opened
 * engine attaches a listener to a "section document" that must see the
 * latest props when it fires.
 */
function Reader({ source, bookId, readingMode, label, onToggle, log }: {
  source: Source | null; bookId: string | null; readingMode: ReadingMode;
  label: string; onToggle: (label: string) => void; log: Log;
}) {
  const handleSectionClick = useEffectEvent(() => {
    log.handled.push(label);
    onToggle(label);
  });
  useReaderEngineSession<Source, string>({
    source, bookId, readingMode,
    open: (session: ReaderEngineSession<Source, string>) => {
      log.opened.push(`${session.key.source.name}/${session.key.bookId}/${session.key.readingMode}@${label}`);
      const section = document.getElementById("section")!;
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- open runs inside useReaderEngineSession's effect event, like FoliateReaderView
      const listener = () => handleSectionClick();
      section.addEventListener("click", listener);
      session.onClose(origin => {
        section.removeEventListener("click", listener);
        log.closed.push(`${session.key.source.name}:${origin ?? "none"}`);
      });
    },
    retiringOrigin: () => `retired-by-${label}`,
  });
  return null;
}

const click = () => document.getElementById("section")!.dispatchEvent(new window.MouseEvent("click"));

test("new callback identities for the same book never re-open the engine; handlers see the latest props", async () => {
  const log: Log = { opened: [], closed: [], handled: [] };
  const toggled: string[] = [];
  const book = { name: "moby" };
  const render = (label: string) => act(async () => {
    root.render(<Reader source={book} bookId="b1" readingMode="scroll" label={label}
      onToggle={value => toggled.push(`${label}:${value}`)} log={log} />);
  });

  await render("one");
  expect(log.opened).toEqual(["moby/b1/scroll@one"]);
  for (const label of ["two", "three", "four"]) await render(label);
  expect(log.opened).toHaveLength(1);
  expect(log.closed).toEqual([]);

  // The section listener was attached during the first render's open, yet it
  // reaches the newest props and the newest callback.
  click();
  expect(log.handled).toEqual(["four"]);
  expect(toggled).toEqual(["four:four"]);
});

test("changing the book, the library id, or the reading mode re-opens the engine", async () => {
  const log: Log = { opened: [], closed: [], handled: [] };
  const first = { name: "moby" }, second = { name: "dune" };
  const render = (source: Source | null, bookId: string | null, readingMode: ReadingMode, label: string) =>
    act(async () => {
      root.render(<Reader source={source} bookId={bookId} readingMode={readingMode} label={label}
        onToggle={() => {}} log={log} />);
    });

  await render(first, "b1", "scroll", "a");
  await render(second, "b2", "scroll", "b");
  // The retiring actor is resolved at teardown time, from the newest render.
  expect(log.closed).toEqual(["moby:retired-by-b"]);
  expect(log.opened).toEqual(["moby/b1/scroll@a", "dune/b2/scroll@b"]);

  await render(second, "b2", "paginated-double", "c");
  expect(log.opened.at(-1)).toBe("dune/b2/paginated-double@c");

  await render(second, "b3", "paginated-double", "d");
  expect(log.opened.at(-1)).toBe("dune/b3/paginated-double@d");
  expect(log.closed).toHaveLength(3);

  // Only the live session's listener remains attached.
  click();
  expect(log.handled).toEqual(["d"]);

  // No book: the last engine closes and nothing new opens.
  await render(null, null, "paginated-double", "e");
  expect(log.closed).toHaveLength(4);
  expect(log.opened).toHaveLength(4);
});

test("unmounting closes the open session", async () => {
  const log: Log = { opened: [], closed: [], handled: [] };
  await act(async () => {
    root.render(<Reader source={{ name: "moby" }} bookId="b1" readingMode="scroll" label="x" onToggle={() => {}} log={log} />);
  });
  await act(async () => { root.render(null); });
  expect(log.closed).toEqual(["moby:retired-by-x"]);
});
