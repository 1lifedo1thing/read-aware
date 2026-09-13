import { expect, test } from "bun:test";
import { PluginEventReactions, type PluginReactionToken } from "./plugin-event-reactions";
import { actorCause, actorOrigin, stampEventCause } from "../../../platform/domain-actor";
import { deferred } from "../../../../tests/helpers/entity-host";

test("delivery leases survive asynchronous callbacks and stop a cross-plugin event loop before another write", async () => {
  const lifetime = new AbortController(), a = new PluginEventReactions("plugin:a", lifetime.signal), b = new PluginEventReactions("plugin:b", lifetime.signal);
  const aRule = {}, bRule = {}, effects: string[] = [];
  await a.deliver(aRule, stampEventCause({}), async aToken => {
    await a.execute(aToken, async actorA => {
      await Promise.resolve(); effects.push(actorOrigin(actorA));
      await b.deliver(bRule, stampEventCause({}, actorA), async bToken => {
        await b.execute(bToken, async actorB => {
          await Promise.resolve(); effects.push(actorOrigin(actorB));
          await a.deliver(aRule, stampEventCause({}, actorB), async reflected => {
            expect(reflected.status).toBe("cycle");
            expect(() => a.execute(reflected, async () => { effects.push("repeated"); })).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
          });
        });
      });
    });
  });
  expect(effects).toEqual(["plugin:a", "plugin:b"]);
  await a.deliver(aRule, stampEventCause({}), token => a.execute(token, async () => { effects.push("independent"); }));
  expect(effects.at(-1)).toBe("independent"); lifetime.abort(); await Promise.all([a.drain(), b.drain()]);
});

test("forged, copied-status, expired, foreign and retired leases cannot invoke operations", async () => {
  const lifetime = new AbortController(), a = new PluginEventReactions("plugin:a", lifetime.signal), b = new PluginEventReactions("plugin:b", lifetime.signal);
  let captured!: PluginReactionToken, effects = 0;
  const write = async () => { effects++; };
  await a.deliver({}, stampEventCause({}), async token => {
    captured = structuredClone(token);
    expect(() => b.execute(token, write)).toThrow();
    expect(() => a.execute({ ...token, status: "cycle" }, write)).toThrow();
    expect(() => a.execute({ id: "forged", status: "ready" }, write)).toThrow();
    await a.execute(captured, write);
  });
  expect(() => a.execute(captured, write)).toThrow(); expect(effects).toBe(1);
  lifetime.abort(); expect(() => a.execute(captured, write)).toThrow(); await a.drain();
});

test("accepted derived work retains its parent after the delivery returns; concurrent user roots stay independent", async () => {
  const lifetime = new AbortController(), owner = new PluginEventReactions("plugin:a", lifetime.signal), gate = deferred();
  const roots: string[] = []; let queued!: Promise<void>;
  await owner.deliver({}, stampEventCause({}), token => {
    queued = owner.execute(token, async actor => { await gate.promise; roots.push(actorCause(actor)!.root); });
  });
  await owner.deliver({}, stampEventCause({}), token => owner.execute(token, async actor => { roots.push(actorCause(actor)!.root); }));
  expect(roots).toHaveLength(1); gate.resolve(); await queued;
  expect(roots).toHaveLength(2); expect(roots[0]).not.toBe(roots[1]); lifetime.abort(); await owner.drain();
});
