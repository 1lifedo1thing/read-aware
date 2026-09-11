import { expect, test } from "bun:test";
import { pluginDataRevision, waitForPluginDataUpdates, withPluginDataUpdate, withPluginDataWrites } from "./plugin-data-access";
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
