/**
 * The scheduler's cadence per backend: the relay runs on its own (start
 * cycle, focus pull, push-on-write, interval), a plugin transport never does
 * — only an explicit `syncNow` moves data. Runs in a child process because
 * the scheduler module binds to `window`/`document` stand-ins at import.
 */
import { expect, spyOn, test } from "bun:test";
import type { SyncEngine } from "./sync-engine";

if (process.env.SYNC_CADENCE_PROOF === "1") {
  const profile = { syncEnabled: true, remoteAccountId: null as string | null, encryptionKeyRef: "sync.master-key", lastPushAt: null, lastPullAt: null };
  const windowListeners: string[] = [], documentListeners: string[] = [], timers: number[] = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    visibilityState: "visible",
    addEventListener(type: string) { documentListeners.push(type); }, removeEventListener() {},
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(handler: () => void, ms: number) { timers.push(ms); return setTimeout(handler, ms); },
    clearTimeout,
    addEventListener(type: string) { windowListeners.push(type); }, removeEventListener() {},
    __TAURI_INTERNALS__: { invoke: async (command: string) => {
      if (command === "sync_profile_get") return profile;
      if (["secret_keys", "restored_credentials_pending", "reading_sessions_pending", "library_cover_backlog"].includes(command)) return [];
      if (command === "sync_outbox_counts") return { events: 0, blobs: 0 };
      if (command === "local_device_get") return { deviceId: "cadence", lastHlcWallMs: null, lastHlcCounter: null };
      return undefined;
    } },
  } });
  const engineModule = await import("./sync-engine");
  const dedupe = await import("../book-dedupe");
  const roaming = await import("../roaming-preferences");
  const secrets = await import("../secret-store");
  const relayModule = await import("./relay-client");
  const { toBase64 } = await import("../sync-envelope");
  const { transportAccountId } = await import("./transport-registry");
  const scheduler = await import("./sync-scheduler");
  let cycles = 0;
  spyOn(engineModule, "createSyncEngine").mockReturnValue({
    async syncOnce() { cycles++; return { pulled: 0, pushed: 0, blobs: 0, verified: 0, backfilled: 0, backfillRemaining: 0, bootstrapped: false }; },
    async fetchBlob() { return "fetched"; },
  } as unknown as SyncEngine);
  spyOn(dedupe, "reconcileDuplicateBooks").mockResolvedValue(0);
  spyOn(roaming, "refreshRoamingPreferences").mockResolvedValue(undefined);
  // The relay doorbell would open a WebSocket; a never-settling ticket keeps it out.
  spyOn(relayModule, "createRelayClient").mockReturnValue({ watchTicket: () => new Promise<string>(() => {}) } as never);
  await secrets.hydrateSecrets();
  await secrets.setSecretAsync("sync.master-key", toBase64(new Uint8Array(32).fill(7)));

  const settle = async () => { for (let i = 0; i < 5; i++) await Bun.sleep(0); };
  const reset = () => { windowListeners.length = 0; documentListeners.length = 0; timers.length = 0; cycles = 0; };

  test("a plugin transport binds without any automatic cycle; only sync now runs one", async () => {
    reset();
    profile.remoteAccountId = transportAccountId("plugin:webdav-sync:webdav", "reader@dav.example.com/ReadAware");
    const dispose = scheduler.startSyncScheduler();
    await settle();
    try {
      const status = scheduler.getSyncStatusSnapshot();
      expect(status).toMatchObject({ state: "idle", accountConnected: true, backend: "transport", transportRef: "plugin:webdav-sync:webdav" });
      expect(cycles).toBe(0);
      expect(windowListeners).toEqual([]);
      expect(documentListeners).toEqual([]);
      expect(timers).toEqual([]);
      await scheduler.syncNow();
      expect(cycles).toBe(1);
      await settle();
      // A finished manual cycle schedules nothing either.
      expect(timers).toEqual([]);
      expect(scheduler.getSyncStatusSnapshot().state).toBe("idle");
    } finally { dispose(); }
  });

  test("the relay keeps its automatic cadence: start cycle, focus and visibility pulls, follow-up interval", async () => {
    reset();
    profile.remoteAccountId = "acct_relay";
    await secrets.setSecretAsync("sync.session", "synthetic-session");
    const dispose = scheduler.startSyncScheduler();
    await settle();
    try {
      expect(scheduler.getSyncStatusSnapshot()).toMatchObject({ backend: "relay", accountConnected: true });
      expect(cycles).toBe(1);
      expect(windowListeners).toEqual(["focus"]);
      expect(documentListeners).toEqual(["visibilitychange"]);
      expect(timers.length).toBeGreaterThan(0);
    } finally { dispose(); await secrets.deleteSecretAsync("sync.session"); }
  });
} else {
  test("isolated sync cadence contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SYNC_CADENCE_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("2 pass");
  }, 30_000);
}
