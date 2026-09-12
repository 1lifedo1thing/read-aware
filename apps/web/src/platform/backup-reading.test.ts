import { expect, test } from "bun:test";

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
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string, args: any) => {
      if (command === "reading_sessions_pending") return pending.map(value => ({ ...value }));
      if (command === "local_device_get") return { deviceId: "reading-proof", lastHlcWallMs: frontier, lastHlcCounter: 10 };
      if (command === "backup_close_reading_sessions") {
        closes++;
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
} else {
  test("isolated full-backup reading closure host boundary", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_READING_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
