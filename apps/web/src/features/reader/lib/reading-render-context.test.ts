import { expect, test } from "bun:test";
import { readingRenderActor, readingRenderContext } from "./reading-render-context";
import { actorCause, actorOrigin, eventCause, reactionActor, stampEventCause } from "../../../platform/domain-actor";
import { attachReadingEngine } from "./reading-engine-adapter";
import { readingRuntime } from "../../../domain/reading-runtime";
import type { FoliateView } from "./foliate-engine";
import type { ReadingSessionSnapshot } from "@read-aware/core";

const reaction = () => reactionActor("plugin:navigator", "navigate-after-change", eventCause(stampEventCause({}))!);

test("opaque render identities preserve host causes; native input has separate roots and no serialized authority", () => {
  const actor = reaction(), context = readingRenderContext(actor);
  expect(JSON.stringify(context)).toBe("{}");
  expect(readingRenderActor({ context })).toBe(actor);
  expect(readingRenderActor({ context })).toBe(actor);
  const native = {}, first = readingRenderActor({ context: native });
  expect(actorOrigin(first)).toBe("user");
  expect(readingRenderActor({ context: native })).toBe(first);
  expect(actorCause(readingRenderActor({ context: {} }))?.root).not.toBe(actorCause(first)?.root);
  // A serialized context cannot copy the host cause. Public commands create
  // their own context after grants are checked, ignoring caller metadata.
  expect(actorCause(readingRenderActor({ context: structuredClone(context) }))?.root).not.toBe(actorCause(actor)?.root);
  const event = {};
  expect(readingRenderActor(event)).toBe(readingRenderActor(event));
});

test("host navigation carries its actor through asynchronous renderer feedback, side effects and the receipt", async () => {
  const events: ReadingSessionSnapshot[] = [], calls: object[] = [], actor = reaction();
  const target = new EventTarget(), paint = Promise.withResolvers<void>();
  const view = Object.assign(target, {
    book: { sections: [{ id: 0, size: 100, load: () => "" }] },
    isFixedLayout: false,
    lastLocation: { cfi: "start", fraction: 0, section: { current: 0, total: 1 } },
    renderer: { getContents: () => [], waitForCurrentRender: () => paint.promise },
    goTo: async (_target: unknown, context?: object) => {
      calls.push(context!); await Promise.resolve();
      view.lastLocation = { ...view.lastLocation, cfi: "destination", fraction: 0.5 };
      target.dispatchEvent(new CustomEvent("relocate", { detail: { context, reason: "navigation" } }));
      return { index: 0 };
    },
    next: async (_distance?: number, context?: object) => {
      calls.push(context!); await Promise.resolve();
      view.lastLocation = { ...view.lastLocation, cfi: "next", fraction: 0.6 };
      target.dispatchEvent(new CustomEvent("relocate", { detail: { context, reason: "page" } }));
    },
  });
  const id = readingRuntime.begin("book");
  const feedback = (event: Event) => readingRuntime.readerDemandActivity(id, "relocate", readingRenderActor((event as CustomEvent<object>).detail));
  target.addEventListener("relocate", feedback);
  const detach = attachReadingEngine(view as unknown as FoliateView, id, "book", "v1");
  const off = readingRuntime.observe(snapshot => { events.push(snapshot); }); events.length = 0;
  try {
    let completed = false;
    const pending = readingRuntime.navigate({ cfi: "destination", context: { origin: "user" } } as never, undefined, actor)
      .then(receipt => { completed = true; return receipt; });
    await Bun.sleep(0);
    expect(completed).toBe(false);
    expect(events.some(snapshot => snapshot.change?.reason === "relocate")).toBe(true);
    expect(events.every(snapshot => eventCause(snapshot) === actorCause(actor))).toBe(true);
    paint.resolve(); expect((await pending).location.cfi).toBe("destination");
    expect(calls).toHaveLength(1); expect(readingRenderActor({ context: calls[0] })).toBe(actor);
    events.length = 0;
    await readingRuntime.step("next", undefined, undefined, "user");
    const userCause = eventCause(readingRuntime.snapshot());
    expect(userCause?.root).not.toBe(actorCause(actor)?.root);
    expect(events.every(snapshot => eventCause(snapshot) === userCause)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("navigate-after-change");
    expect(readingRuntime.snapshot().location).not.toHaveProperty("context");
  } finally { off(); detach(); target.removeEventListener("relocate", feedback); readingRuntime.closed(); }
});
