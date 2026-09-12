import { expect, spyOn, test } from "bun:test";

if (process.env.BACKUP_READING_PROOF === "1") {
  const bucket = { bookId: "book", localDay: "2026-09-12", localHour: 10, ms: 20,
    startedAt: 1000, lastAt: 1020, progress: null, positionAt: null };
  let pending = [{ ...bucket }];
  let failure: string | null = null;
  let failuresLeft = 0;
  let closes = 0;
  let frontier = Date.now() + 1_000_000;
  const requests: any[][] = [];
  const published: any[] = [];
  let closeGate: Promise<void> | undefined;
  const writes: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string, args: any) => {
      if (command === "reading_session_accrue" || command === "reading_session_position") {
        writes.push(command);
        let row = pending.find(row => row.bookId === args.bookId);
        if (!row) { row = { ...bucket, bookId: args.bookId, ms: 0, startedAt: args.atEpochMs, lastAt: args.atEpochMs }; pending.push(row); }
        if (command === "reading_session_accrue") row.ms += args.deltaMs;
        else Object.assign(row, { progress: args.progress, positionAt: args.atEpochMs });
        return row;
      }
      if (command === "reading_session_flush") {
        pending = []; return { appended: args.events.length, applied: args.events.length };
      }
      if (command === "reading_sessions_pending") return pending.map(value => ({ ...value }));
      if (command === "local_device_get") return { deviceId: "reading-proof", lastHlcWallMs: frontier, lastHlcCounter: 10 };
      if (command === "backup_close_reading_sessions") {
        closes++;
        await closeGate;
        requests.push(args.events);
        for (const event of args.events) {
          expect(event.hlc.wallMs >= frontier).toBe(true);
          expect(event.origin).toBe("system");
        }
        if (failure && failuresLeft-- > 0) {
          frontier += 1000;
          pending = pending.map(value => ({ ...value, ms: value.ms + 5 }));
          throw { code: failure, message: "synthetic failure" };
        }
        pending = [];
        return args.events.map((event: any) => ({ ...event, payload: { ...event.payload, ms: 37, endedAt: 1037 } }));
      }
      return undefined;
    },
  } } });
  const { closeReadingSessionsForBackup: close } = await import("./reading-session");
  const { onDomainEventBroadcast } = await import("./domain-events");
  onDomainEventBroadcast(event => published.push(event));

  test("backup observers receive only native committed facts; an empty retry does not publish twice", async () => {
    expect(await close()).toBe(1);
    expect(requests[0]![0].payload.ms).toBe(20);
    expect(published[0].payload.ms).toBe(37);
    expect(await close()).toBe(0);
    expect(published).toHaveLength(1);
  });
  test("failed close propagates without broadcast; stale catalogs reload and remint within a bounded retry", async () => {
    pending = [{ ...bucket }]; failure = "db/locked"; failuresLeft = 1;
    await expect(close()).rejects.toMatchObject({ code: "db/locked" });
    expect(published).toHaveLength(1);
    failure = "backup/changed"; failuresLeft = 1;
    const before = closes;
    expect(await close()).toBe(1);
    expect(closes).toBe(before + 2);
    const previous = requests.at(-2)![0]; const current = requests.at(-1)![0];
    expect(current.id).not.toBe(previous.id);
    expect(current.hlc.wallMs).toBeGreaterThan(previous.hlc.wallMs);
    expect(current.payload.ms).toBe(previous.payload.ms + 5);
    pending = [{ ...bucket }]; failuresLeft = 10;
    const beforeFailure = closes;
    await expect(close()).rejects.toMatchObject({ code: "backup/changed" });
    expect(closes).toBe(beforeFailure + 3);
    expect(published).toHaveLength(2);
  });
  test("inert buckets are retired by native closure without inventing an event", async () => {
    pending = [{ ...bucket, ms: 0 }]; failure = null;
    expect(await close()).toBe(0);
    expect(requests.at(-1)).toEqual([]);
    expect(pending).toEqual([]);
    expect(published).toHaveLength(2);
  });

  test("production backup entries close native facts before IO and retain later observations until IO ends", async () => {
    const { readingTraces } = await import("../features/reader/lib/reading-trace-runtime");
    const { exportBackup, importBackup } = await import("../features/settings/lib/backup-io");
    const kv = await import("./local-store");
    const library = await import("../features/library/lib/library-db");
    const annotations = await import("../features/annotations/lib/annotation-db");
    const profile = await import("../domain/user-profile");
    for (const mode of ["export", "import"] as const) {
      pending = []; failure = null;
      const closing = Promise.withResolvers<void>(), io = Promise.withResolvers<void>();
      closeGate = closing.promise;
      let entered = false;
      const readOrWrite = async () => {
        expect(pending).toEqual([]); entered = true;
        await io.promise; expect(pending).toEqual([]);
        return {};
      };
      const mocks = [
        spyOn(kv, "dumpLocalKV").mockImplementation(readOrWrite),
        spyOn(kv, "restoreLocalKV").mockImplementation(async () => { await readOrWrite(); }),
        spyOn(library, "listLibraryBooks").mockResolvedValue([]),
        spyOn(library, "listCollections").mockResolvedValue([]),
        spyOn(annotations, "listAnnotations").mockResolvedValue([]),
        spyOn(profile, "readUserProfileSnapshot").mockResolvedValue({ summary: null, revision: "empty" }),
      ];
      const trace = readingTraces.begin(`backup-${mode}`, "book");
      const unbind = trace.bindSampler(() => trace.accrue(1000, 1020));
      const before = writes.length;
      const result = mode === "export" ? exportBackup() : importBackup(JSON.stringify({ kind: "backup", version: 1, books: [], kv: {} }));
      try {
        await Bun.sleep(0); expect(entered).toBe(false); expect(writes.length).toBe(before + 1);
        trace.position({ locator: "after-snapshot" }, 1040);
        closing.resolve(); closeGate = undefined;
        await Bun.sleep(0); expect(entered).toBe(true);
        expect(writes.length).toBe(before + 1);
        io.resolve(); await result;
        await Bun.sleep(0); expect(writes.length).toBe(before + 2);
        expect(trace.accepting).toBe(true);
        expect((pending[0] as any).progress.locator).toBe("after-snapshot");
      } finally {
        closing.resolve(); io.resolve(); closeGate = undefined;
        await result;
        unbind(); await trace.retire();
        for (const mock of mocks) mock.mockRestore();
      }
    }
  });
} else {
  test("isolated full-backup reading closure host boundary", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_READING_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("4 pass");
  }, 30_000);
}
