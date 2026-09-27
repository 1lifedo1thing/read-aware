import { describe, expect, test } from "bun:test";
import { ReaderEngineSession } from "./reader-engine-session";

const key = { source: {}, bookId: "book", readingMode: "scroll" as const };

describe("ReaderEngineSession", () => {
  test("runs teardowns once, in registration order, with the retiring origin", () => {
    const session = new ReaderEngineSession<object, string>(key);
    const calls: string[] = [];
    session.onClose(origin => calls.push(`a:${origin}`));
    session.onClose(origin => calls.push(`b:${origin}`));
    expect(session.closed).toBe(false);
    session.close("user");
    session.close("system");
    expect(session.closed).toBe(true);
    expect(calls).toEqual(["a:user", "b:user"]);
  });

  test("bindings are undone before resources are released, each phase in registration order", () => {
    const session = new ReaderEngineSession<object, string>(key);
    const calls: string[] = [];
    session.onRelease(() => calls.push("close view"));
    session.onClose(() => calls.push("unbind runtime"));
    session.onRelease(() => calls.push("release book"));
    session.onClose(() => calls.push("remove listeners"));
    session.close();
    expect(calls).toEqual(["unbind runtime", "remove listeners", "close view", "release book"]);
  });

  test("a teardown registered after the close runs at once, so a late resource is released", () => {
    const session = new ReaderEngineSession<object, string>(key);
    session.close("user");
    const calls: Array<string | undefined> = [];
    session.onClose(origin => calls.push(origin));
    session.onRelease(() => calls.push("released"));
    expect(calls).toEqual([undefined, "released"]);
  });

  test("a throwing teardown does not strand the others", () => {
    const session = new ReaderEngineSession(key);
    const calls: string[] = [];
    session.onClose(() => { calls.push("first"); throw Error("teardown failed"); });
    session.onClose(() => calls.push("second"));
    session.onRelease(() => calls.push("resource"));
    expect(() => session.close()).toThrow("teardown failed");
    expect(calls).toEqual(["first", "second", "resource"]);
    expect(session.closed).toBe(true);
  });
});
