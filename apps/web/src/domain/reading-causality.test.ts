import { expect, test } from "bun:test";
import { ReadingSessionController } from "./reading-session-controller";
import { ReadingControlsController } from "../features/reader/lib/reading-controls-controller";
import { ReadAloudController, type PlaybackCallbacks, type PlaybackInput } from "../features/reader/lib/read-aloud-controller";
import { PluginEventReactions } from "../features/plugins/runtime/plugin-event-reactions";
import { actorCause, actorFromEvent, causalActor, eventCause, reactionActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import type { ReadingSessionSnapshot } from "@read-aware/core";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const reaction = () => reactionActor("plugin:reader", "react-to-reading", eventCause(stampEventCause({}))!);
const at = { bookId: "book", contentVersion: "v1", cfi: "start" };
const engine = () => ({ navigate: async () => at, step: async () => at });

test("opening, delayed readiness, failure and demand cooldown retain their exact request source", async () => {
  const actor = reaction(), snapshots: ReadingSessionSnapshot[] = [];
  const runtime = new ReadingSessionController(undefined, 1000, 5);
  runtime.observe(snapshot => { snapshots.push(snapshot); });
  const id = runtime.begin("book", undefined, actor);
  expect(runtime.openingActor(id)).toBe(actor);
  await tick(); runtime.attach(id, engine(), at);
  expect(eventCause(runtime.snapshot())).toBe(actorCause(actor));
  runtime.readerDemandActivity(id, "relocate", actor);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(runtime.snapshot().readerDemand?.active).toBe(false);
  expect(eventCause(runtime.snapshot())).toBe(actorCause(actor));
  runtime.fail(id, new Error("render failed"));
  expect(snapshots.slice(1).every(snapshot => eventCause(snapshot) === actorCause(actor))).toBe(true);
  const user = runtime.begin("book");
  expect(eventCause(runtime.snapshot())?.root).not.toBe(actorCause(actor)?.root);
  expect(() => runtime.openingActor(id)).toThrow(expect.objectContaining({ code: "reader/superseded" }));
  runtime.attach(user, engine(), at);
  expect(eventCause(runtime.snapshot())).toBe(actorCause(runtime.openingActor(user)));
  runtime.closed();
});

test("render acknowledgements keep command causes; replaced and aborted renders cannot reattribute user state", async () => {
  const runtime = new ReadingSessionController(), controls = new ReadingControlsController(() => {});
  const id = runtime.begin("book"); runtime.attach(id, engine(), at); runtime.bindControls(id, controls);
  const actor = reaction();
  const pending = runtime.setControls(true, undefined, undefined, actor);
  await tick(); controls.acknowledge(controls.getRenderState()); await pending;
  expect(eventCause(runtime.snapshot())).toBe(actorCause(actor));
  expect(JSON.stringify(runtime.snapshot())).not.toContain("react-to-reading");
  const replaced = runtime.setControls(false, undefined, undefined, actor).catch(error => error);
  const stale = controls.getRenderState();
  controls.setFromUI(false); controls.acknowledge(controls.getRenderState());
  const user = runtime.snapshot();
  expect(user.change?.origin).toBe("user");
  expect(eventCause(user)?.root).not.toBe(actorCause(actor)?.root);
  controls.acknowledge(stale);
  expect(await replaced).toMatchObject({ code: "reader/superseded" });
  expect(eventCause(runtime.snapshot())).toBe(eventCause(user));
  const abort = new AbortController();
  const cancelled = runtime.setControls(true, abort.signal, undefined, actor).catch(error => error);
  const discarded = controls.getRenderState(); abort.abort(); await cancelled;
  controls.acknowledge(discarded); controls.acknowledge(controls.getRenderState());
  expect(runtime.snapshot().controls?.visible).toBe(false);
  expect(eventCause(runtime.snapshot())).toBe(eventCause(user));
  runtime.closed();
});

test("controls feedback carries A to B to A and rejects a repeated reaction, but accepts a later user action", async () => {
  const runtime = new ReadingSessionController(), controls = new ReadingControlsController(() => {});
  const id = runtime.begin("book"); runtime.attach(id, engine(), at); runtime.bindControls(id, controls);
  const life = new AbortController(), a = new PluginEventReactions("plugin:a", life.signal), b = new PluginEventReactions("plugin:b", life.signal);
  const ruleA = {}, ruleB = {};
  const set = async (visible: boolean, actor: DomainActor) => {
    const pending = runtime.setControls(visible, undefined, undefined, actor);
    await tick(); controls.acknowledge(controls.getRenderState()); await pending;
  };
  await a.deliver(ruleA, stampEventCause({}), token => a.execute(token, actor => set(true, actor)));
  await b.deliver(ruleB, runtime.snapshot(), token => b.execute(token, actor => set(false, actor)));
  const before = runtime.snapshot();
  await a.deliver(ruleA, before, async token => {
    expect(token.status).toBe("cycle");
    expect(() => a.execute(token, actor => set(true, actor))).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
  });
  expect(runtime.snapshot()).toEqual(before);
  controls.setFromUI(true); controls.acknowledge(controls.getRenderState());
  await a.deliver(ruleA, runtime.snapshot(), token => a.execute(token, actor => set(false, actor)));
  expect(runtime.snapshot().controls?.visible).toBe(false);
  life.abort(); runtime.closed();
});

test("a delayed successful controls receipt cannot relabel the newer user's rendered state", async () => {
  const runtime = new ReadingSessionController(), controls = new ReadingControlsController(() => {}), actor = reaction();
  const id = runtime.begin("book"); runtime.attach(id, engine(), at); runtime.bindControls(id, controls);
  let user: ReadingSessionSnapshot | undefined;
  controls.observe(() => {
    if (!controls.snapshot().visible) return;
    controls.setFromUI(false); controls.acknowledge(controls.getRenderState()); user = runtime.snapshot();
  });
  const pending = runtime.setControls(true, undefined, undefined, actor);
  controls.acknowledge(controls.getRenderState());
  expect((await pending).controls.visible).toBe(true);
  expect(runtime.snapshot().controls?.visible).toBe(false);
  expect(runtime.snapshot().change?.origin).toBe("user");
  expect(eventCause(runtime.snapshot())).toBe(eventCause(user!));
  expect(eventCause(runtime.snapshot())?.root).not.toBe(actorCause(actor)?.root);
  runtime.closed();
});

function playback() {
  const calls: PlaybackCallbacks[] = [];
  const runtime = new ReadingSessionController(), actor = reaction();
  const id = runtime.begin("book"); runtime.attach(id, engine(), at);
  const controller = new ReadAloudController({ systemAvailable: () => true, report: () => {},
    speak: (_text, callbacks) => { calls.push(callbacks); return { cancel() {} }; },
    play: (_bytes, callbacks) => { calls.push(callbacks); return { cancel() {} }; } }, 30, 30);
  let input: PlaybackInput = { enabled: true, unit: { text: "First", cfiRange: "first" }, voice: null,
    next: async () => "end-of-book", peekNext: () => null };
  const update = (patch: Partial<PlaybackInput>, source?: DomainActor) => { input = { ...input, ...patch }; controller.update(input, source); };
  update({}); runtime.bindPlayback(id, controller);
  return { runtime, actor, controller, calls, update };
}

test("playback preparation, fallback, audio callbacks, automatic advance and final stop keep one cause", async () => {
  const f = playback(), snapshots: ReadingSessionSnapshot[] = [];
  let advanceCause: DomainActor | undefined;
  f.update({ voice: { synthesize: async () => { await tick(); throw Error("provider unavailable"); } },
    next: async (_signal, origin) => { advanceCause = origin; await tick(); return "end-of-book"; } });
  f.runtime.observe(snapshot => { if (snapshot.change?.reason === "playback") snapshots.push(snapshot); });
  snapshots.length = 0;
  const pending = f.runtime.controlPlayback("start", f.actor);
  await tick(); await tick(); f.calls[0]!.onStart(); await pending;
  f.calls[0]!.onEnd(); await tick(); await tick();
  expect(f.runtime.snapshot().playback?.status).toBe("stopped");
  expect(snapshots.some(snapshot => snapshot.playback?.fallback)).toBe(true);
  expect(snapshots.every(snapshot => eventCause(snapshot) === actorCause(f.actor))).toBe(true);
  expect(advanceCause).toBe(f.actor);
  f.runtime.closed();
});

test("late synthesis and old abort cannot change the cause of a replacement user playback", async () => {
  const f = playback(), synthesis = Promise.withResolvers<ArrayBuffer>(), old = new AbortController();
  f.update({ voice: { synthesize: () => synthesis.promise } });
  const pending = f.runtime.controlPlayback("start", f.actor, old.signal).catch(error => error);
  f.update({ voice: null });
  const user = causalActor("user"), next = f.runtime.controlPlayback("start", user);
  f.calls.at(-1)!.onStart(); await next;
  const state = f.runtime.snapshot();
  synthesis.reject(new Error("late provider failure")); old.abort(); await tick();
  expect(await pending).toMatchObject({ code: "reader/superseded" });
  expect(f.runtime.snapshot()).toEqual(state);
  expect(eventCause(f.runtime.snapshot())).toBe(actorCause(user));
  f.runtime.closed();
});

test("host continuations require stamped objects and never trust a serialized cause", () => {
  const actor = causalActor("user"), event = stampEventCause({ value: 1 }, actor);
  expect(actorCause(actorFromEvent(event))).toBe(actorCause(actor));
  expect(() => actorFromEvent(structuredClone(event))).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
  expect(() => causalActor(structuredClone(actor))).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
});

test("selection changes and clears keep their initiating source through the render barrier", async () => {
  const runtime = new ReadingSessionController(), id = runtime.begin("book"), actor = reaction();
  const range = { ...at, cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)" };
  const selection = { id: "selected", text: "needle", textLength: 6, range };
  runtime.attach(id, { navigate: async () => range, step: async () => range }, at);
  const render = Promise.withResolvers<void>(), snapshots: ReadingSessionSnapshot[] = [];
  runtime.bindSelection(id, {
    validate: async () => {},
    select: async (_range, _expectedId, _signal, source) => {
      runtime.selectionChanged(id, selection, source);
      await render.promise; return selection;
    },
    clear: async (_id, _signal, source) => { await tick(); runtime.selectionChanged(id, null, source); },
    retire: () => {},
  });
  runtime.observe(snapshot => { snapshots.push(snapshot); }); snapshots.length = 0;
  let completed = false;
  const selected = runtime.selectRange(range, undefined, undefined, actor).then(receipt => { completed = true; return receipt; });
  await tick();
  expect(completed).toBe(false); expect(runtime.snapshot().selection?.id).toBe(selection.id);
  expect(eventCause(runtime.snapshot())).toBe(actorCause(actor));
  render.resolve(); await selected;
  await runtime.clearSelection(selection.id, undefined, undefined, actor);
  expect(runtime.snapshot().selection).toBeNull();
  expect(snapshots.every(snapshot => eventCause(snapshot) === actorCause(actor))).toBe(true);
  runtime.selectionChanged(id, selection);
  expect(eventCause(runtime.snapshot())?.root).not.toBe(actorCause(actor)?.root);
  runtime.closed();
});

test("a reaction taking over during audio start cannot acknowledge its own playback with the old callback", async () => {
  const f = playback(); let takeover: Promise<unknown> | undefined, completed = false;
  f.runtime.observe(state => {
    if (state.playback?.status !== "playing" || state.playback.owner !== "plugin:reader") return;
    takeover = f.runtime.controlPlayback("start", "user").then(receipt => { completed = true; return receipt; });
  });
  const old = f.runtime.controlPlayback("start", f.actor).catch(error => error);
  f.calls[0]!.onStart(); await tick();
  expect(await old).toMatchObject({ code: "reader/superseded" });
  expect(takeover).toBeDefined(); expect(completed).toBe(false);
  expect(f.runtime.snapshot().playback?.status).toBe("preparing");
  f.calls.at(-1)!.onStart(); await takeover;
  expect(completed).toBe(true); expect(f.runtime.snapshot().playback?.owner).toBe("user");
  f.runtime.closed();
});

test("stopping in an advancing notification prevents the old callback from dispatching a unit step", async () => {
  const f = playback(); let steps = 0;
  f.update({ next: async () => { steps++; return "end-of-book"; } });
  f.runtime.observe(state => { if (state.playback?.status === "advancing") f.controller.stop(); });
  const pending = f.runtime.controlPlayback("start", f.actor); f.calls[0]!.onStart(); await pending;
  f.calls[0]!.onEnd(); await tick();
  expect(steps).toBe(0); expect(f.runtime.snapshot().playback?.status).toBe("stopped");
  expect(eventCause(f.runtime.snapshot())?.root).not.toBe(actorCause(f.actor)?.root);
  f.runtime.closed();
});
