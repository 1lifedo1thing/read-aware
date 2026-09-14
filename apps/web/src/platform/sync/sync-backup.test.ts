import { actorCause, causalActor, eventCause } from "../domain-actor";
import { expect, spyOn, test } from "bun:test";
import type { SyncEngine } from "./sync-engine";
import type { RelayClient } from "./relay-client";

if (process.env.SYNC_BACKUP_PROOF === "1") {
  const commands: string[] = [], order: string[] = [], blobs = new Map<string, ArrayBuffer>();
  let commitGate: Promise<void> | undefined;
  let failSecretDelete = false;
  const profile = { syncEnabled: true, remoteAccountId: null as string | null, encryptionKeyRef: "sync.master-key", lastPushAt: null, lastPullAt: null };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {},
    __TAURI_INTERNALS__: { invoke: async (command: string, args: any) => {
      commands.push(command);
      if (command === "secret_delete" && failSecretDelete) throw { code: "db/locked" };
      if (command === "sync_profile_get") return profile;
      if (["secret_keys", "restored_credentials_pending", "reading_sessions_pending", "library_cover_backlog"].includes(command)) return [];
      if (command === "sync_outbox_counts") return { events: 0, blobs: 0 };
      if (command === "local_device_get") return { deviceId: "sync-backup", lastHlcWallMs: null, lastHlcCounter: null };
      if (command === "get_blob") return blobs.get(args.key) ?? new ArrayBuffer(0);
      if (command === "get_blob_info") return blobs.has(args.key) ? { byteSize: blobs.get(args.key)!.byteLength } : null;
      if (command === "commit_events") { await commitGate; return { appended: args.events.length, applied: args.events.length }; }
      return undefined;
    } },
  } });
  const engineModule = await import("./sync-engine");
  const roaming = await import("../roaming-preferences");
  const dedupe = await import("../book-dedupe");
  const kv = await import("../local-store");
  const library = await import("../../features/library/lib/library-db");
  const annotations = await import("../../features/annotations/lib/annotation-db");
  const userProfile = await import("../../domain/user-profile");
  const secrets = await import("../secret-store");
  const { withPluginDataWrites, withPluginRuntimeDataWrite } = await import("../plugin-data-access");
  const { toBase64 } = await import("../sync-envelope");
  const scheduler = await import("./sync-scheduler");
  const { exportBackup, importBackup } = await import("../../features/settings/lib/backup-io");
  const outcome = { pulled: 1, pushed: 0, blobs: 0, verified: 0, backfilled: 0, backfillRemaining: 0, bootstrapped: false };
  let cycleGate: Promise<void> | undefined, downloadGate: Promise<void> | undefined;
  let cycles = 0;
  let writeJournal = false;
  let refreshDownloadToken: (() => Promise<void>) | undefined;
  const downloads: string[] = [];
  const engineFactory = spyOn(engineModule, "createSyncEngine").mockReturnValue({
    async syncOnce() {
      cycles++; order.push("cycle"); await cycleGate;
      if (writeJournal) {
        writeJournal = false;
        kv.localKV.setItem("read-aware-plugin.sync-backup.settings", '{"accepted":true}');
      }
      return outcome;
    },
    async fetchBlob(key: string) {
      downloads.push(key); order.push(`fetch:${key}`);
      await refreshDownloadToken?.();
      await downloadGate;
      blobs.set(key, new TextEncoder().encode("synthetic book").buffer as ArrayBuffer);
      return "fetched";
    },
  } as SyncEngine);
  spyOn(dedupe, "reconcileDuplicateBooks").mockResolvedValue(0);
  spyOn(roaming, "refreshRoamingPreferences").mockImplementation(async () => {
    await withPluginDataWrites(["sync-backup"], async () => { order.push("overlay"); });
  });
  await secrets.hydrateSecrets();
  await secrets.setSecretAsync("sync.session", "synthetic-session");
  await secrets.setSecretAsync("sync.master-key", toBase64(new Uint8Array(32).fill(11)));
  await kv.localKV.setItemAsync("read-aware-sync-relay-url", '"http://localhost:8787"');

  test("source discovery shares download admission without opening engines or transport sessions", async () => {
    const { registerSyncTransport, transportAccountId } = await import("./transport-registry");
    const oldAccount = profile.remoteAccountId, oldEnabled = profile.syncEnabled;
    let opens = 0;
    const count = downloads.length, engines = engineFactory.mock.calls.length;
    const dispose = registerSyncTransport("prerequisites", { id: "source", label: "Source", open: async () => { opens++; throw Error("must not open"); } });
    try {
      profile.syncEnabled = false;
      expect(await scheduler.getRemoteBlobFetchConditions()).toContainEqual(expect.objectContaining({ reason: "source-sync-disabled" }));
      expect(await scheduler.fetchRemoteBlob("denied")).toEqual({ outcome: "unavailable", reason: "sync-off" });
      profile.syncEnabled = true;
      await secrets.deleteSecretAsync("sync.session");
      expect(await scheduler.getRemoteBlobFetchConditions()).toContainEqual(expect.objectContaining({ reason: "source-sync-credentials-missing" }));
      profile.remoteAccountId = transportAccountId("plugin:prerequisites:source", "private-endpoint");
      const ready = await scheduler.getRemoteBlobFetchConditions();
      expect(ready).toContainEqual({ kind: "provider", state: "unknown", reason: "source-download-not-checked" });
      expect(JSON.stringify(ready)).not.toContain("private-endpoint"); expect(opens).toBe(0);
      await dispose();
      expect(await scheduler.getRemoteBlobFetchConditions()).toContainEqual(expect.objectContaining({ reason: "source-transport-unavailable" }));
      expect(await scheduler.fetchRemoteBlob("retired")).toEqual({ outcome: "unavailable", reason: "not-connected" });
      expect(downloads).toHaveLength(count); expect(engineFactory.mock.calls).toHaveLength(engines);
      const abort = new AbortController(); abort.abort(new Error("retired"));
      await expect(scheduler.getRemoteBlobFetchConditions(abort.signal)).rejects.toThrow("retired");
    } finally { await dispose(); profile.remoteAccountId = oldAccount; profile.syncEnabled = oldEnabled; await secrets.setSecretAsync("sync.session", "synthetic-session"); }
  });

  test("real export waits for the cycle overlay, admits its own missing source download and defers new sync producers", async () => {
    refreshDownloadToken = () => withPluginRuntimeDataWrite(() => secrets.setPluginSecret("download-token", "refresh", "synthetic"));
    const first = Promise.withResolvers<void>(), source = Promise.withResolvers<void>();
    cycleGate = first.promise; downloadGate = source.promise;
    const reads = [
      spyOn(kv, "dumpLocalKV").mockImplementation(async () => { order.push("backup-read"); return {}; }),
      spyOn(library, "listLibraryBooks").mockResolvedValue([{ id: "source" } as any]),
      spyOn(library, "listCollections").mockResolvedValue([]),
      spyOn(annotations, "listAnnotations").mockResolvedValue([]),
      spyOn(userProfile, "readUserProfileSnapshot").mockResolvedValue({ summary: null, revision: "empty" }),
    ];
    const origin = causalActor("plugin:sync-proof");
    const initial = scheduler.syncNow(origin); await Bun.sleep(0); expect(cycles).toBe(1);
    expect(eventCause(scheduler.getSyncStatusSnapshot())).toEqual(actorCause(origin));
    let saved = false;
    const backup = exportBackup().then(json => { saved = true; return JSON.parse(json); });
    const laterCycle = scheduler.syncNow(), laterBlob = scheduler.fetchRemoteBlob("later");
    try {
    await Bun.sleep(0); expect(order).toEqual(["cycle"]); expect(downloads).toEqual([]);
    first.resolve(); cycleGate = undefined; await initial; await Bun.sleep(0);
    expect(order).toContain("overlay"); expect(order).not.toContain("backup-read");
    expect(cycles).toBe(1); expect(downloads).toHaveLength(1); expect(downloads[0]).toContain("source");
    expect(saved).toBe(false);
    source.resolve(); downloadGate = undefined;
    const result = await backup;
    expect(order.indexOf("overlay")).toBeLessThan(order.indexOf("backup-read"));
    expect(atob(result.files.source)).toBe("synthetic book");
    await laterCycle; expect(await laterBlob).toEqual({ outcome: "fetched" });
    expect(cycles).toBe(2); expect(downloads).toContain("later");
    } finally {
      first.resolve(); source.resolve(); cycleGate = undefined; downloadGate = undefined;
      await Promise.allSettled([initial, backup, laterCycle, laterBlob]);
      refreshDownloadToken = undefined;
      for (const read of reads) read.mockRestore();
    }
  });

  test("real import retains sync exclusion through its last write and caller cancellation", async () => {
    const writing = Promise.withResolvers<void>(), controller = new AbortController();
    let entered = false;
    const write = spyOn(kv, "restoreLocalKV").mockImplementation(async () => { entered = true; await writing.promise; });
    const imported = importBackup(JSON.stringify({ kind: "backup", books: [], kv: {} }), controller.signal);
    await Bun.sleep(0); expect(entered).toBe(true);
    const before = cycles, cycle = scheduler.syncNow();
    controller.abort(); await Bun.sleep(0); expect(cycles).toBe(before);
    writing.resolve(); expect(await imported).toMatchObject({ books: 0 });
    await cycle; expect(cycles).toBe(before + 1); write.mockRestore();
  });

  test("connection persistence waits outside backup; escaped backup fetchers cannot write later", async () => {
    const hold = Promise.withResolvers<void>();
    let escaped: typeof scheduler.fetchRemoteBlob | undefined;
    const paused = scheduler.withSyncBackup(async fetch => { escaped = fetch; await hold.promise; });
    await Bun.sleep(0);
    const before = commands.filter(command => command === "secret_set").length;
    const connect = scheduler.persistConnection({ session: "synthetic-next", accountId: "synthetic-account", masterKeyBase64: toBase64(new Uint8Array(32).fill(12)) });
    await Bun.sleep(0); expect(commands.filter(command => command === "secret_set")).toHaveLength(before);
    hold.resolve(); await paused; await connect;
    expect(commands.filter(command => command === "secret_set")).toHaveLength(before + 2);
    const count = downloads.length;
    await expect(escaped!("outside")).rejects.toMatchObject({ code: "backup/busy" });
    expect(downloads).toHaveLength(count);
    scheduler.startSyncScheduler()();
  });

  test("backup cancellation drains the cycle's queued KV publication before releasing sync admission", async () => {
    const commit = Promise.withResolvers<void>(), controller = new AbortController();
    commitGate = commit.promise; writeJournal = true;
    await scheduler.syncNow(); await Bun.sleep(0);
    const before = cycles;
    let entered = false, finished = false;
    const paused = scheduler.withSyncBackup(async () => { entered = true; }, controller.signal)
      .catch(error => { finished = true; return error; });
    await Bun.sleep(0); controller.abort(new Error("cancelled"));
    const later = scheduler.syncNow();
    await Bun.sleep(0); expect(finished).toBe(false); expect(cycles).toBe(before);
    await expect(scheduler.withSyncBackup(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
    commit.resolve(); commitGate = undefined;
    expect((await paused).message).toBe("cancelled"); expect(entered).toBe(false);
    await later; expect(cycles).toBe(before + 1);
  });

  test("scheduler work deferred by backup does not revive an already disposed scheduler", async () => {
    const relayModule = await import("./relay-client");
    const ticket = Promise.withResolvers<string>();
    const relay = spyOn(relayModule, "createRelayClient").mockReturnValue({ watchTicket: () => ticket.promise } as RelayClient);
    const before = cycles;
    profile.remoteAccountId = "synthetic-account";
    try {
      await scheduler.withSyncBackup(async () => {
        const dispose = scheduler.startSyncScheduler();
        await Bun.sleep(0); expect(cycles).toBe(before);
        dispose(); ticket.resolve("synthetic-ticket");
        await Bun.sleep(0);
      });
      await Bun.sleep(0); expect(cycles).toBe(before);
      expect(scheduler.getSyncStatusSnapshot().lastCycle).toBeNull();
    } finally { ticket.resolve("synthetic-ticket"); profile.remoteAccountId = null; relay.mockRestore(); }
  });

  test("disconnect waits for credential deletion and cannot claim profile teardown after a failed delete", async () => {
    const relayModule = await import("./relay-client");
    const relay = spyOn(relayModule, "createRelayClient").mockReturnValue({ logout: async () => {} } as RelayClient);
    const before = commands.filter(command => command === "sync_profile_set").length;
    failSecretDelete = true;
    try {
      await expect(scheduler.disconnectSync()).rejects.toMatchObject({ code: "db/locked" });
      expect(commands.filter(command => command === "sync_profile_set")).toHaveLength(before);
      expect(await scheduler.withSyncBackup(async () => "released")).toBe("released");
    } finally { failSecretDelete = false; relay.mockRestore(); }
  });
} else {
  test("isolated scheduler and production backup admission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SYNC_BACKUP_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("7 pass");
  }, 30_000);
}
