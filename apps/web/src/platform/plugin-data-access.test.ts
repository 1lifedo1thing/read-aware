import { expect, test } from "bun:test";
import { pluginDataRevision, waitForPluginDataUpdates, withPluginDataBackup, withPluginDataUpdate, withPluginDataWrites } from "./plugin-data-access";
import { runPluginUpdateTransaction } from "../features/plugins/runtime/plugin-update-transaction";
const gate = () => { let resolve!: () => void; return { promise: new Promise<void>(r => { resolve = r; }), release: () => resolve() }; };
const tick = () => Bun.sleep(0);

test("an update closes admission immediately and waits for accepted external writes even on failure", async () => {
  const pending = gate(); const migration = gate(); const events: string[] = [];
  const write = withPluginDataWrites(["isolate-a"], async () => { await pending.promise; events.push("saved"); throw new Error("save failed"); }).catch(e => e);
  const update = withPluginDataUpdate("isolate-a", async () => { events.push("snapshot"); await migration.promise; });
  await expect(withPluginDataWrites(["isolate-b", "isolate-a"], () => events.push("bad batch"))).rejects.toMatchObject({ code: "plugin/data-busy" });
  await withPluginDataWrites(["isolate-b"], () => events.push("other plugin"));
  await expect(withPluginDataUpdate("isolate-a", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
  expect(events).toEqual(["other plugin"]);
  pending.release(); await write; await tick();
  expect(events).toEqual(["other plugin", "saved", "snapshot"]);
  migration.release(); await update;
  await withPluginDataWrites(["isolate-a"], () => events.push("after"));
});

test("both pre-update and during-update forms become stale, and scopes cannot escape or cross owners", async () => {
  const old = new Map([["isolate-form", pluginDataRevision("isolate-form")]]);
  let middle!: Map<string, object>; let retained!: Parameters<Parameters<typeof withPluginDataUpdate>[1]>[0];
  await expect(withPluginDataUpdate("isolate-form", async scope => {
    retained = scope; middle = new Map([["isolate-form", pluginDataRevision("isolate-form")]]);
    await withPluginDataUpdate("isolate-form", async same => { expect(same).toBe(scope); }, scope);
    await expect(withPluginDataUpdate("different", async () => {}, scope)).rejects.toMatchObject({ code: "plugin/data-busy" });
    throw new Error("rolled back");
  })).rejects.toThrow("rolled back");
  for (const expected of [old, middle]) await expect(withPluginDataWrites(["isolate-form"], () => {}, expected)).rejects.toMatchObject({ code: "plugin/settings-stale" });
  await expect(withPluginDataUpdate("isolate-form", async () => {}, retained)).rejects.toMatchObject({ code: "plugin/data-busy" });
  await withPluginDataWrites(["isolate-form"], () => {}, new Map([["isolate-form", pluginDataRevision("isolate-form")]]));
});

test("update rollback and old-runtime restart retain the external write barrier through cleanup", async () => {
  const cleanup = gate(); const recovery = gate(); const log: string[] = []; let data = "saved", baseline = "";
  const run = withPluginDataUpdate("isolate-rollback", scope => runPluginUpdateTransaction({
    startCandidate: async () => ({}), verifyCandidate: () => {}, quiescePrevious: () => {},
    snapshotData: () => { baseline = data; }, commitFiles: async () => {}, verifyCommit: () => {},
    migrateCandidate: () => { data = "candidate"; throw new Error("migration failed"); },
    promoteCandidate: () => {}, accept: () => {}, retirePrevious: () => {},
    cleanupCandidate: () => cleanup.promise, rollbackFiles: async () => {},
    restoreData: async () => { data = baseline; await recovery.promise; },
    restartPrevious: () => withPluginDataUpdate("isolate-rollback", async () => { log.push("restarted"); }, scope),
  })).catch(e => e);
  await tick();
  let finished = false; const wait = waitForPluginDataUpdates(["isolate-rollback"]).then(() => { finished = true; });
  await expect(withPluginDataWrites(["isolate-rollback"], () => { data = "overwritten"; })).rejects.toMatchObject({ code: "plugin/data-busy" });
  cleanup.release(); await tick(); expect(data).toBe("saved"); expect(finished).toBe(false);
  recovery.release(); expect((await run).message).toContain("migration failed"); await wait;
  expect(log).toEqual(["restarted"]); expect(data).toBe("saved");
});


test("backup reservation excludes all update owners and drains admitted saves before IO", async () => {
  const save = gate(), io = gate(); const events: string[] = [];
  const writer = withPluginDataWrites(["backup-save"], async () => { await save.promise; events.push("saved"); });
  const operation = withPluginDataBackup("export", async () => { events.push("snapshot"); await io.promise; });
  await expect(withPluginDataUpdate("never-seen-before", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
  await expect(withPluginDataWrites(["also-new"], () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
  await expect(withPluginDataBackup("import", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
  await withPluginDataWrites([], () => events.push("ordinary settings"));
  let roaming = false;
  const waiting = waitForPluginDataUpdates(["backup-save"]).then(() => { roaming = true; });
  expect(events).toEqual(["ordinary settings"]);
  save.release(); await writer; await tick(); expect(events.at(-1)).toBe("snapshot"); expect(roaming).toBe(false);
  io.release(); await operation; await waiting; expect(roaming).toBe(true);
  await withPluginDataUpdate("never-seen-before", async () => {});
});

test("backup cannot enter a live migration and failed import invalidates both generations of forms", async () => {
  const migration = gate(); let calls = 0;
  const update = withPluginDataUpdate("backup-migration", () => migration.promise);
  await expect(withPluginDataBackup("export", async () => { calls++; })).rejects.toMatchObject({ code: "plugin/data-busy" });
  migration.release(); await update; expect(calls).toBe(0);
  const before = new Map([["backup-form", pluginDataRevision("backup-form")]]);
  let during!: Map<string, object>;
  await expect(withPluginDataBackup("import", async () => {
    during = new Map([["backup-form", pluginDataRevision("backup-form")]]);
    throw new Error("partial import failure");
  })).rejects.toThrow("partial import failure");
  for (const revision of [before, during]) await expect(withPluginDataWrites(["backup-form"], () => {}, revision)).rejects.toMatchObject({ code: "plugin/settings-stale" });
  const fresh = new Map([["backup-form", pluginDataRevision("backup-form")]]);
  await withPluginDataBackup("export", async () => {});
  await withPluginDataWrites(["backup-form"], () => {}, fresh);
});

test("cancelled backup admission drains accepted writes but never begins data IO", async () => {
  const saved = gate(); const controller = new AbortController(); let calls = 0;
  const writer = withPluginDataWrites(["backup-cancel"], () => saved.promise);
  const result = withPluginDataBackup("import", async () => { calls++; }, controller.signal).catch(error => error);
  controller.abort();
  await expect(withPluginDataUpdate("backup-cancel", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
  saved.release(); await writer;
  expect(await result).toBeInstanceOf(Error); expect(calls).toBe(0);
  await withPluginDataUpdate("backup-cancel", async () => {});
});
