/**
 * The mailbox Durable Object's own contracts, below the HTTP surface: the
 * stored-event counter (what `/v1/account` and every quota check read
 * instead of scanning the table), the doorbell's ring discipline, and the
 * per-account socket cap.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { AccountMailbox, DOORBELL_SUPERSEDED, MAX_DOORBELL_SOCKETS, doorbellEvictions } from "../src/do-mailbox";
import { MailboxCore } from "../src/mailbox-core";
import { newMailboxCore, sealed, sqlOver, transactOver } from "./harness";

const AT = "2026-10-09T00:00:00.000Z";

describe("the stored-event counter", () => {
  test("tracks appends, ignores redeliveries and in-batch duplicates, resets on wipe", () => {
    const core = newMailboxCore();
    expect(core.count()).toBe(0);
    const first = core.append([sealed("a"), sealed("b"), sealed("a")], AT);
    expect(first).toMatchObject({ appended: 2 });
    expect(core.count()).toBe(2);
    expect(core.append([sealed("a"), sealed("b")], AT)).toMatchObject({ appended: 0, seqs: { a: 1, b: 2 } });
    expect(core.count()).toBe(2);
    core.append([sealed("c")], AT);
    expect(core.count()).toBe(3);
    core.wipe();
    expect(core.count()).toBe(0);
    core.append([sealed("d")], AT);
    expect(core.count()).toBe(1);
  });

  test("a mailbox from before the counter is backfilled once, then kept exact", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
      hlc_wall_ms INTEGER NOT NULL, hlc_counter INTEGER NOT NULL, hlc_device TEXT NOT NULL,
      envelope_json TEXT NOT NULL, received_at TEXT NOT NULL)`);
    for (const id of ["old-1", "old-2", "old-3"]) {
      db.query(`INSERT INTO events (event_id, hlc_wall_ms, hlc_counter, hlc_device, envelope_json, received_at)
                VALUES (?1, 1, 1, 'd', '{}', ?2)`).run(id, AT);
    }
    const core = new MailboxCore(sqlOver(db), transactOver(db));
    core.ensureSchema();
    expect(core.count()).toBe(3);
    // A second wake-up must not re-count (or double-count) anything.
    core.ensureSchema();
    core.append([sealed("new-1")], AT);
    expect(core.count()).toBe(4);
  });

  test("a batch that fails halfway rolls back rows AND counter together", () => {
    const core = newMailboxCore();
    core.append([sealed("kept")], AT);
    const broken = { ...sealed("broken"), hlc: { wallMs: null, counter: 1, deviceId: "d" } };
    expect(() => core.append([sealed("lost"), broken as never], AT)).toThrow();
    expect(core.count()).toBe(1);
    expect(core.lookup(["kept", "lost"])).toEqual({ kept: 1 });
  });

  test("over the cap (a lapsed paid tier), redelivery still acknowledges; new events refuse", () => {
    const core = newMailboxCore();
    core.append([sealed("a"), sealed("b"), sealed("c")], AT);
    expect(core.append([sealed("a"), sealed("b")], AT, 2)).toMatchObject({ appended: 0, seqs: { a: 1, b: 2 } });
    expect(core.append([sealed("d")], AT, 2)).toBe("full");
    expect(core.count()).toBe(3);
  });
});

type FakeSocket = {
  sent: string[];
  closed: number | null;
  attachment: unknown;
  send(data: string): void;
  close(code?: number): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

function fakeSocket(openedAt?: number): FakeSocket {
  return {
    sent: [],
    closed: null,
    attachment: openedAt === undefined ? null : { openedAt },
    send(data) {
      this.sent.push(data);
    },
    close(code) {
      this.closed = code ?? 1000;
    },
    serializeAttachment(value) {
      this.attachment = value;
    },
    deserializeAttachment() {
      return this.attachment;
    },
  };
}

function mailboxWithSockets(sockets: FakeSocket[]) {
  const db = new Database(":memory:");
  const mailbox = new AccountMailbox({
    storage: { sql: sqlOver(db), transactionSync: (fn) => db.transaction(fn)() },
    blockConcurrencyWhile: (fn) => void fn(),
    acceptWebSocket: (ws) => sockets.push(ws as FakeSocket),
    getWebSockets: () => sockets.filter((ws) => ws.closed === null),
  });
  const append = (events: unknown[]) =>
    mailbox.fetch(
      new Request("https://mailbox/append", {
        method: "POST",
        body: JSON.stringify({ events }),
        headers: { "content-type": "application/json" },
      }),
    );
  return { append };
}

describe("the doorbell", () => {
  test("rings on new events only — a pure redelivery wakes nobody", async () => {
    const device = fakeSocket(1);
    const { append } = mailboxWithSockets([device]);
    expect((await append([sealed("a"), sealed("b")])).status).toBe(200);
    expect(device.sent).toEqual([JSON.stringify({ type: "changed", seq: 2 })]);
    expect((await append([sealed("a"), sealed("b")])).status).toBe(200);
    expect(device.sent).toHaveLength(1);
  });

  test("at the cap, the oldest sockets make room — ghosts never lock out a live device", () => {
    const held = Array.from({ length: MAX_DOORBELL_SOCKETS }, (_, i) => fakeSocket(1_000 + i));
    const legacy = fakeSocket(); // accepted before attachments existed
    expect(doorbellEvictions(held.slice(0, MAX_DOORBELL_SOCKETS - 1))).toEqual([]);
    expect(doorbellEvictions(held)).toEqual([held[0]]);
    expect(doorbellEvictions([...held.slice(1), legacy])).toEqual([legacy]);
    expect(doorbellEvictions([...held, fakeSocket(5_000)])).toEqual([held[0], held[1]]);
    expect(DOORBELL_SUPERSEDED).toBeGreaterThanOrEqual(4000);
  });
});
