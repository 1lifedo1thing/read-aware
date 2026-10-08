/**
 * The mailbox's SQL, shared verbatim between the Durable Object (SQLite
 * storage API) and the bun:sqlite-backed tests. `server_seq` comes from
 * AUTOINCREMENT: monotonic, never reused, and the DO's single-threaded
 * execution makes assignment race-free without any locking of our own.
 *
 * Billing shape: Durable Object SQLite bills every row a statement READS, so
 * no hot path may scan the events table. The stored-event total lives in a
 * one-row `mailbox_meta` counter maintained in the same transaction as the
 * rows it counts; quota checks and `/v1/account` read one row, not N.
 */
import type { SealedEventWire } from "@read-aware/core";

/** The one sql-execution shape both `ctx.storage.sql` and the tests provide. */
export type SqlExec = {
  exec(
    query: string,
    ...bindings: (string | number | null)[]
  ): {
    toArray(): Record<string, unknown>[];
  };
};

/**
 * Run `fn` as one atomic SQLite transaction: `ctx.storage.transactionSync`
 * in the DO, `db.transaction` under bun:sqlite. Every write that touches
 * both `events` and the counter goes through it — a throw halfway rolls
 * both back, so the counter can never drift from the table.
 */
export type SqlTransact = <T>(fn: () => T) => T;

export type AppendOutcome =
  | {
      /** Event id → server_seq, for every id in the batch (new or known). */
      seqs: Record<string, number>;
      /** How many of the batch's events were NEW rows. */
      appended: number;
    }
  | "full";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
     seq          INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id     TEXT NOT NULL UNIQUE,
     hlc_wall_ms  INTEGER NOT NULL,
     hlc_counter  INTEGER NOT NULL,
     hlc_device   TEXT NOT NULL,
     envelope_json TEXT NOT NULL,
     received_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS mailbox_meta (
     id           INTEGER PRIMARY KEY CHECK (id = 1),
     event_count  INTEGER NOT NULL
   )`,
];

export class MailboxCore {
  constructor(
    private sql: SqlExec,
    private transact: SqlTransact,
  ) {}

  ensureSchema(): void {
    this.transact(() => {
      for (const statement of SCHEMA) this.sql.exec(statement);
      // Mailboxes created before the counter existed get it backfilled ONCE —
      // the only full count this class ever runs. Every later wake-up finds
      // the row and reads exactly one.
      const meta = this.sql.exec(`SELECT event_count FROM mailbox_meta WHERE id = 1`).toArray()[0];
      if (!meta) {
        this.sql.exec(`INSERT INTO mailbox_meta (id, event_count) SELECT 1, COUNT(*) FROM events`);
      }
    });
  }

  append(events: SealedEventWire[], receivedAt: string, maxEvents = Number.MAX_SAFE_INTEGER): AppendOutcome {
    return this.transact(() => {
      // One indexed lookup per distinct id (event_id is UNIQUE) — the same
      // map then answers redeliveries and in-batch duplicates below.
      const known = new Map<string, number>();
      for (const ev of events) {
        if (known.has(ev.id)) continue;
        const row = this.sql.exec(`SELECT seq FROM events WHERE event_id = ?1`, ev.id).toArray()[0];
        if (row) known.set(ev.id, Number(row.seq));
      }
      const fresh = new Set(events.filter((ev) => !known.has(ev.id)).map((ev) => ev.id));

      // Quota: refusal must be atomic — a half-appended batch whose response
      // says "full" would leave the client with events it can neither confirm
      // nor retire. A batch with nothing new is never refused: redelivering
      // what the relay already holds is not new usage, even on an account a
      // downgrade left over its cap.
      if (fresh.size > 0 && this.count() + fresh.size > maxEvents) return "full";

      const seqs: Record<string, number> = {};
      let appended = 0;
      for (const ev of events) {
        const existing = known.get(ev.id);
        if (existing !== undefined) {
          seqs[ev.id] = existing;
          continue;
        }
        // Check-then-insert, NOT `INSERT OR IGNORE`: an ignored conflict still
        // burns an AUTOINCREMENT value, so every crash-redelivery would blow
        // holes in the seq space. The DO's single-threaded execution makes the
        // lookup above and this insert race-free.
        const row = this.sql
          .exec(
            `INSERT INTO events
               (event_id, hlc_wall_ms, hlc_counter, hlc_device, envelope_json, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             RETURNING seq`,
            ev.id,
            ev.hlc.wallMs,
            ev.hlc.counter,
            ev.hlc.deviceId,
            JSON.stringify(ev),
            receivedAt,
          )
          .toArray()[0];
        const seq = Number(row?.seq);
        known.set(ev.id, seq);
        seqs[ev.id] = seq;
        appended += 1;
      }
      if (appended > 0) {
        this.sql.exec(`UPDATE mailbox_meta SET event_count = event_count + ?1 WHERE id = 1`, appended);
      }
      return { seqs, appended };
    });
  }

  listAfter(after: number, limit: number): { events: SealedEventWire[]; next: number; seqs: number[] } {
    const rows = this.sql
      .exec(`SELECT seq, envelope_json FROM events WHERE seq > ?1 ORDER BY seq LIMIT ?2`, after, limit)
      .toArray();
    const events = rows.map((row) => JSON.parse(String(row.envelope_json)) as SealedEventWire);
    const seqs = rows.map((row) => Number(row.seq));
    const next = rows.length > 0 ? seqs[seqs.length - 1] : after;
    return { events, next, seqs };
  }

  /** Known ids → seq. One indexed lookup per id (event_id is UNIQUE); the
   *  DO's single-threaded execution keeps the batch consistent. */
  lookup(ids: string[]): Record<string, number> {
    const seqs: Record<string, number> = {};
    for (const id of ids) {
      const row = this.sql.exec(`SELECT seq FROM events WHERE event_id = ?1`, id).toArray()[0];
      if (row) seqs[id] = Number(row.seq);
    }
    return seqs;
  }

  /** Stored events — one counter row, never a scan of `events`. */
  count(): number {
    return Number(this.sql.exec(`SELECT event_count FROM mailbox_meta WHERE id = 1`).toArray()[0]?.event_count ?? 0);
  }

  /** MAX over the INTEGER PRIMARY KEY is a single b-tree seek, not a scan. */
  maxSeq(): number {
    return Number(this.sql.exec(`SELECT COALESCE(MAX(seq), 0) AS s FROM events`).toArray()[0]?.s ?? 0);
  }

  wipe(): void {
    this.transact(() => {
      this.sql.exec(`DELETE FROM events`);
      this.sql.exec(`UPDATE mailbox_meta SET event_count = 0 WHERE id = 1`);
    });
  }
}
