import { expect, test } from "bun:test";
import { actorCause, actorOrigin, copyEventCause, eventCause, reactionActor, stampEventCause, type DomainActor } from "./domain-actor";
import { broadcastDomainEventDrafts, onDomainEventBroadcast, type DomainEventBroadcast } from "./domain-events";
import { createUserProfileService } from "../domain/user-profile";
import { KVWriteQueue, type KVCommit } from "./kv-write-queue";
import { ReadingSessionController } from "../domain/reading-session-controller";

const root = () => eventCause(stampEventCause({}))!;

test("cross-domain reactions reject A to B to A before repeating an effect, while independent actions and distinct rules work", async () => {
  const events: DomainEventBroadcast[] = [];
  const off = onDomainEventBroadcast(event => { events.push(event); });
  try {
    const a = reactionActor("plugin:a", "a:star-to-profile", root());
    await Promise.resolve();
    broadcastDomainEventDrafts([{ type: "profile.updated", origin: a, payload: { summary: "from A" } }]);
    const b = reactionActor("plugin:b", "b:profile-to-star", eventCause(events[0]!)!);
    await Promise.resolve();
    broadcastDomainEventDrafts([{ type: "book.starred", origin: b, payload: { bookId: "book", starred: true } }]);
    const reflected = eventCause(events[1]!)!;
    expect(() => reactionActor("plugin:a", "a:star-to-profile", reflected)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
    expect(actorOrigin(reactionActor("plugin:a", "a:another-rule", reflected))).toBe("plugin:a");
    expect(actorOrigin(reactionActor("plugin:a", "a:star-to-profile", root()))).toBe("plugin:a");
    expect(events.map(event => event.origin)).toEqual(["plugin:a", "plugin:b"]);
    expect(JSON.stringify(events)).not.toContain("star-to-profile");
  } finally { off(); }
});

test("a conditional domain write keeps its immutable cause across awaits and emits only after a successful native receipt", async () => {
  const events: DomainEventBroadcast[] = [], calls: unknown[] = [];
  const actor = reactionActor("plugin:a", "a:profile", root());
  let fail = false;
  const off = onDomainEventBroadcast(event => { events.push(event); });
  const service = createUserProfileService({
    mint: async drafts => {
      await Promise.resolve();
      return drafts.map(draft => ({ ...draft, origin: draft.origin === undefined ? undefined : actorOrigin(draft.origin), id: "event", hlc: { wallMs: 1, counter: 0, deviceId: "test" } }));
    },
    broadcast: broadcastDomainEventDrafts,
    invoke: async <T>(command: string, args?: unknown): Promise<T> => {
      calls.push({ command, args }); await Promise.resolve();
      if (command === "profile_initialize") return { migrated: false } as T;
      if (command !== "profile_commit") throw Error(`Unexpected ${command}`);
      if (fail) throw Error("native write failed");
      return { changed: true, revision: `profile2:${"b".repeat(64)}`, persistence: "event-log" } as T;
    },
  });
  try {
    const change = { summary: "After", expectedRevision: `profile2:${"a".repeat(64)}` };
    await service.change(change, actor);
    expect(events).toHaveLength(1); expect(eventCause(events[0]!)).toBe(actorCause(actor));
    expect(JSON.stringify(calls)).not.toContain("a:profile");
    fail = true; await expect(service.change(change, actor)).rejects.toThrow("native write failed");
    expect(events).toHaveLength(1);
  } finally { off(); }
});

test("queued writes keep separate causal origins even when their operations overlap", async () => {
  const commits: KVCommit[] = [], store = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const queue = new KVWriteQueue({ read: key => store.get(key) ?? null,
    mirror: (key, value) => { if (value === null) store.delete(key); else store.set(key, value); },
    persist: async () => {}, committed: () => {}, settled: commit => { commits.push(commit); }, failed: () => {} });
  const a = reactionActor("plugin:a", "a:settings", root()), b = reactionActor("plugin:b", "b:settings", root());
  const first = queue.batch(new Map([["a", "1"]]), () => gate, a);
  const second = queue.batch(new Map([["b", "2"]]), async () => {}, b);
  release(); await Promise.all([first, second]);
  expect(commits.map(commit => commit.actor)).toEqual(["plugin:a", "plugin:b"]);
  expect(commits.map(commit => eventCause(commit))).toEqual([actorCause(a), actorCause(b)]);
  expect(eventCause(commits[0]!)).not.toBe(eventCause(commits[1]!));
});

test("scope copies and reading snapshots retain host provenance without serializing it", () => {
  const actor = reactionActor("plugin:a", "a:reader", root());
  const original = stampEventCause({ value: 1 }, actor), copied = copyEventCause(original, structuredClone(original));
  expect(eventCause(copied)).toBe(actorCause(actor));
  const reader = new ReadingSessionController();
  reader.begin("book", undefined, actor);
  const snapshot = reader.snapshot();
  expect(snapshot.change?.origin).toBe("plugin:a"); expect(eventCause(snapshot)).toBe(actorCause(actor));
  expect(JSON.stringify(snapshot)).not.toContain("a:reader"); reader.closed();
});

test("copied, forged and excessively deep causal contexts fail closed", () => {
  const a = reactionActor("plugin:a", "a:one", root());
  expect(() => actorCause(structuredClone(a) as DomainActor)).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
  expect(() => actorOrigin({ origin: "user", cause: actorCause(a)! })).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
  let cause = root();
  for (let index = 0; index < 32; index++) cause = actorCause(reactionActor("plugin:a", `a:${index}`, cause))!;
  expect(() => reactionActor("plugin:a", "a:33", cause)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
});

test("an invalid actor is rejected before a queued persistence effect or optimistic mirror", () => {
  let effects = 0;
  const queue = new KVWriteQueue({ read: () => null, mirror: () => { effects++; }, persist: async () => { effects++; },
    committed: () => {}, failed: () => {} });
  const invalid = { origin: "user" as const, cause: root() };
  expect(() => queue.write("key", "value", "local", invalid)).toThrow();
  expect(queue.pending).toBe(false); expect(effects).toBe(0);
});
