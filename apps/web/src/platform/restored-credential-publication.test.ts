import { expect, test } from "bun:test";

if (process.env.RESTORED_CREDENTIAL_PROOF === "1") {
  const pending = new Set<string>();
  const commands: string[] = [];
  const published: unknown[] = [];
  let masterWrite: (() => void) | null = null;
  let holdMaster = false;
  let failure: string | null = null;
  let frontier = Date.now() + 1_000_000;
  let publishCount = 0;
  let failedClock = 0;
  let requestedValues: unknown[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string, args: any) => {
      commands.push(command);
      if (command === "secret_set") {
        if (holdMaster) await new Promise<void>(resolve => { masterWrite = resolve; });
        return;
      }
      if (command === "secret_delete") return;
      if (command === "restored_credentials_pending") return [...pending].sort().slice(0, 100);
      if (command === "local_device_get") return { deviceId: "restore-proof", lastHlcWallMs: frontier, lastHlcCounter: 10 };
      if (command === "restored_credentials_publish") {
        publishCount++;
        requestedValues = args.events.map((event: any) => event.payload.value);
        for (const event of args.events) expect(event.hlc.wallMs >= frontier).toBe(true);
        if (failure) {
          const code = failure; failure = null;
          if (code === "backup/changed") { failedClock = args.events[0].hlc.wallMs; frontier += 1000; }
          throw { code, message: "synthetic failure" };
        }
        const events = args.events.map((event: any) => ({ ...event, payload: { key: event.payload.key, value: null } }));
        events.forEach((event: any) => pending.delete(event.payload.key.slice("secret:".length)));
        return { events, awaitingConnection: false };
      }
      return undefined;
    },
  } } });
  const secrets = await import("./secret-store");
  const { flushRestoredCredentialPublications: flush } = await import("./restored-credential-publication");
  const { onDomainEventBroadcast } = await import("./domain-events");
  onDomainEventBroadcast(event => published.push(event));
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  test("offline markers wait for durable connection writes; concurrent flushes share one dispatch and publish only after receipt", async () => {
    pending.add("ai-api-key.deleted");
    await flush();
    expect(publishCount).toBe(0);
    holdMaster = true;
    const write = secrets.setSecretAsync("sync.master-key", "synthetic master");
    await tick();
    const first = flush(); const second = flush();
    expect(first).toBe(second);
    await tick(); expect(publishCount).toBe(0); expect(published).toHaveLength(0);
    holdMaster = false; masterWrite!(); await write; await first;
    expect(publishCount).toBe(1); expect(pending.size).toBe(0);
    expect(published).toHaveLength(1);
    expect(requestedValues).toEqual([null]); // Native code owns actual sealing.
  });
  test("failed native publication retains its markers and never broadcasts; a later call retries", async () => {
    pending.add("ai-api-key.retry"); failure = "db/locked";
    const before = published.length;
    await expect(flush()).rejects.toMatchObject({ code: "db/locked" });
    expect(pending.size).toBe(1); expect(published).toHaveLength(before);
    await flush(); expect(pending.size).toBe(0); expect(published).toHaveLength(before + 1);
  });
  test("a stale native clock reloads the frontier and remints before retry", async () => {
    pending.add("ai-api-key.clock"); failure = "backup/changed";
    const before = publishCount;
    await flush();
    expect(publishCount).toBe(before + 2);
    expect(frontier > failedClock).toBe(true);
    expect(pending.size).toBe(0);
    expect(commands).not.toContain("commit_events"); // No second, non-atomic publication path.
  });
} else {
  test("isolated restored-credential host publication", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, RESTORED_CREDENTIAL_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
