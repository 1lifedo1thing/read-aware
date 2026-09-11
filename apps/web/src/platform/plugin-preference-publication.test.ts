import { expect, test } from "bun:test";
import { PluginPreferencePublication as Publication } from "./plugin-preference-publication";
import { withPluginDataUpdate, withPluginDataWrites } from "./plugin-data-access";

test("only net durable changes of the accepted owner survive, including deletions", async () => {
  const baseline = { same: "1", replaced: "1", removed: "true" };
  const scope = Publication.begin("publish-net", baseline);
  baseline.replaced = "999";
  expect(Publication.record("read-aware-plugin.other.same", "2")).toBe(false);
  for (const [key, raw] of [["same", "1"], ["replaced", "2"], ["replaced", "3"], ["removed", null], ["transient", "true"], ["transient", null]] as const) {
    expect(Publication.record(`read-aware-plugin.publish-net.${key}`, raw)).toBe(true);
  }
  expect(Publication.blocks("read-aware-plugin.publish-net.unwritten")).toBe(true);
  const batches: unknown[] = [];
  await scope.accept(async changes => { batches.push([...changes]); }, () => {});
  expect(batches).toEqual([[["read-aware-plugin.publish-net.replaced", "3"], ["read-aware-plugin.publish-net.removed", null]]]);
  await scope.accept(async changes => { batches.push([...changes]); }, () => {});
  expect(batches).toHaveLength(1);
  expect(Publication.blocks("read-aware-plugin.publish-net.same")).toBe(false);
});

test("rolled-back candidates publish nothing and retired scopes cannot clear a new generation", async () => {
  const old = Publication.begin("publish-rollback", {});
  Publication.record("read-aware-plugin.publish-rollback.setting", "2");
  old.rollback();
  const next = Publication.begin("publish-rollback", {});
  old.rollback(); await old.accept(async () => { throw new Error("Must not publish"); }, () => { throw new Error("Must not report"); });
  expect(Publication.blocks("read-aware-plugin.publish-rollback.setting")).toBe(true);
  expect(() => Publication.begin("publish-rollback", {})).toThrow();
  next.rollback();
});

test("unsafe recovery retains quarantine against publication, settings writes and further updates", async () => {
  const scope = Publication.begin("publish-quarantine", {});
  Publication.record("read-aware-plugin.publish-quarantine.setting", "2"); scope.quarantine();
  expect(Publication.isQuarantined("read-aware-plugin.publish-quarantine.setting")).toBe(true);
  expect(() => scope.accept(async () => {}, () => {})).toThrow();
  await expect(withPluginDataWrites(["publish-quarantine"], () => {})).rejects.toMatchObject({ code: "plugin/recovery-required" });
  await expect(withPluginDataUpdate("publish-quarantine", async () => {})).rejects.toMatchObject({ code: "plugin/recovery-required" });
  await withPluginDataWrites(["publish-healthy"], () => {});
  // Only a host which actually restored the baseline may release it.
  scope.rollback();
});


test("accepted append failures retain final values, block stale overlays, and retry in order with later writes", async () => {
  const scope = Publication.begin("publish-retry", { settings: "1" });
  Publication.record("read-aware-plugin.publish-retry.settings", "2");
  const batches: unknown[] = [], errors: unknown[] = []; let fail = true; let finish!: () => void;
  const publish = async (changes: ReadonlyMap<string, string | null>) => {
    batches.push([...changes]);
    if (fail) throw new Error("log unavailable");
    if (batches.length === 2) await new Promise<void>(resolve => { finish = resolve; });
  };
  await scope.accept(publish, error => errors.push(error));
  expect(errors).toHaveLength(1);
  expect(Publication.suppressesOverlay("read-aware-plugin.publish-retry.settings")).toBe(true);
  await withPluginDataWrites(["publish-retry"], () => {});
  fail = false;
  const retry = Publication.flushAccepted(); await Bun.sleep(0);
  Publication.record("read-aware-plugin.publish-retry.settings", "3");
  expect(batches).toHaveLength(2);
  finish(); await retry; await Publication.flushAccepted();
  expect(batches).toEqual([
    [["read-aware-plugin.publish-retry.settings", "2"]],
    [["read-aware-plugin.publish-retry.settings", "2"]],
    [["read-aware-plugin.publish-retry.settings", "3"]],
  ]);
  expect(Publication.blocks("read-aware-plugin.publish-retry.settings")).toBe(false);
});
