import { expect, spyOn, test } from "bun:test";
import { ReadingSessionController } from "../domain/reading-session-controller";
import { ReaderFocusService, readerFocus } from "./reader-focus";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";
import { createReaderPort } from "../features/ai/agent/ports/reader-port";
import { JSDOM } from "jsdom";
import { readingRuntime } from "../domain/reading-runtime";
import { actorCause, causalActor, eventCause, stampEventCause } from "../platform/domain-actor";
import { focusReaderElement } from "../features/reader/lib/reader-focus-target";
import { readingInputContext } from "../features/reader/lib/reading-document-input";
import { readingRenderActor } from "../features/reader/lib/reading-render-context";

test("semantic focus checks live session identity, ignores retired bindings and never navigates", async () => {
  const reading = new ReadingSessionController(() => {}), service = new ReaderFocusService(reading);
  const id = reading.begin("book"), at = { bookId: "book", contentVersion: "v1", cfi: "at" };
  reading.attach(id, { navigate: async () => at, step: async () => at }, at);
  const before = reading.snapshot(); let calls = 0;
  expect(await service.focus("chat")).toMatchObject({ status: "not-focused", reason: "missing" });
  const old = service.bind("content", { sessionId: id, bookId: "book", focus: () => { throw new Error("retired binding"); } });
  const release = service.bind("content", { sessionId: id, bookId: "book", focus: () => { calls++; return { status: "focused" }; } });
  old();
  expect(await service.focus("content", undefined, { sessionId: id, bookId: "book" })).toEqual({ status: "focused", target: "content", sessionId: id, bookId: "book" });
  expect(reading.snapshot()).toEqual(before); expect(calls).toBe(1);
  await expect(service.focus("selector" as never)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(service.focus("content", undefined, { bookId: "other" })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(service.focus("content", undefined, { selector: "textarea" } as never)).rejects.toMatchObject({ code: "reader/invalid-target" });
  await expect(service.focus("content", AbortSignal.abort())).rejects.toBeDefined(); expect(calls).toBe(1);
  release(); expect(await service.focus("content")).toMatchObject({ status: "not-focused", reason: "missing" });
  service.bind("content", { sessionId: id, bookId: "book", focus: () => { reading.begin("next"); return { status: "focused" }; } });
  await expect(service.focus("content")).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(service.focus("content")).rejects.toMatchObject({ code: "reader/unavailable" });
});

test("plugin focus requires reading write and uses the same service as the production Agent port", async () => {
  const runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const actor = (permissions: PluginPermission[]) => {
    const runtime = buildPluginContext({ id: "focus-test", name: "Focus", version: "1.0.0", schemaVersion: 1,
      requires: { services: { ui: "^1.14.0" } }, permissions }, "0.5.4", []);
    runtime.lifecycle.promote(); runtimes.push(runtime); return runtime;
  };
  const spy = spyOn(readerFocus, "focus").mockResolvedValue({ status: "not-focused", reason: "blocked", target: "chat", bookId: "book", sessionId: "session" });
  try {
    expect(actor([]).context.services.ui.reader).toBeUndefined();
    expect(actor(["reading:read"]).context.services.ui.reader?.focus).toBeUndefined();
    const runtime = actor(["reading:write"]), command = runtime.context.services.ui.reader!.focus!;
    const guard = { sessionId: "session", bookId: "book" };
    expect(await command("chat", guard)).toMatchObject({ status: "not-focused", reason: "blocked" });
    expect(spy).toHaveBeenLastCalledWith("chat", runtime.lifecycle.signal, guard, "plugin:focus-test");
    const controller = new AbortController();
    await createReaderPort().focus("chat", controller.signal, guard);
    expect(spy).toHaveBeenLastCalledWith("chat", controller.signal, guard, "agent");
    runtime.lifecycle.stop(); expect(() => command("chat", guard)).toThrow();
  } finally { spy.mockRestore(); for (const runtime of runtimes) runtime.lifecycle.stop(); }
});

test("public all/book plugin focus carries reaction ancestry into actual DOM events and rejects a cycle", async () => {
  const dom = new JSDOM('<main tabindex="-1"></main><textarea></textarea>'), doc = dom.window.document;
  const content = doc.querySelector("main")!, chat = doc.querySelector("textarea")!;
  for (const element of [content, chat]) Object.defineProperty(element, "getClientRects", { value: () => [{ width: 100, height: 20 }] });
  let observed = stampEventCause({});
  doc.addEventListener("focusin", event => { observed = stampEventCause({}, readingRenderActor(readingInputContext(event))); }, true);
  try {
    for (const mode of ["all", "book"] as const) {
      const id = readingRuntime.begin("book"), at = { bookId: "book", contentVersion: "v1", cfi: "here" };
      readingRuntime.attach(id, { navigate: async () => at, step: async () => at }, at);
      const contentRelease = readerFocus.bind("content", { sessionId: id, bookId: "book", focus: origin => focusReaderElement(content, origin) });
      const chatRelease = readerFocus.bind("chat", { sessionId: id, bookId: "book", focus: origin => focusReaderElement(chat, origin) });
      const create = (name: string) => {
        const runtime = buildPluginContext({ id: name, name, version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:write"] }, "1", [],
          mode === "book" ? { mode, bookId: "book" } : { mode });
        runtime.lifecycle.promote(); return runtime;
      };
      const a = create(`focus-a-${mode}`), b = create(`focus-b-${mode}`), ruleA = {}, ruleB = {};
      try {
        chat.focus();
        await a.reactions.deliver(ruleA, stampEventCause({}, causalActor("user")), async reaction => {
          const source = a.reactions.actor(reaction), bound = a.context.withEvent({ reaction });
          await Promise.resolve();
          expect(await bound.services.ui.reader!.focus!("content")).toMatchObject({ status: "focused" });
          expect(eventCause(observed)).toBe(actorCause(source));
        });
        await b.reactions.deliver(ruleB, observed, async reaction => {
          const source = b.reactions.actor(reaction), bound = b.context.withEvent({ reaction });
          await Promise.resolve(); await bound.services.ui.reader!.focus!("chat");
          expect(eventCause(observed)).toBe(actorCause(source));
        });
        await a.reactions.deliver(ruleA, observed, reaction => {
          expect(reaction.status).toBe("cycle");
          expect(() => a.context.withEvent({ reaction })).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
        });
        expect(doc.activeElement).toBe(chat);
        await readerFocus.focus("content");
        await a.reactions.deliver(ruleA, observed, async reaction => {
          expect(reaction.status).not.toBe("cycle");
          await a.context.withEvent({ reaction }).services.ui.reader!.focus!("chat");
        });
      } finally {
        a.lifecycle.stop(); b.lifecycle.stop(); await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]);
        contentRelease(); chatRelease(); readingRuntime.closed();
      }
    }
  } finally { readingRuntime.closed(); dom.window.close(); }
});
