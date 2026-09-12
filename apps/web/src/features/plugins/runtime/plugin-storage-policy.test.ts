import { expect, test } from "bun:test";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { createPluginStoragePolicy } from "./plugin-storage-policy";

test("storage policy separates eligibility, quotas and backup boundaries; retirement discards delayed usage", async () => {
  const life = new PluginLifecycleController([]); life.promote();
  const usage = { kv:{items:1,valueBytes:2},documents:{items:3,valueBytes:4},assets:{items:0,valueBytes:0} };
  let finish!: () => void, entered!: () => void, delay = false;
  const gate = new Promise<void>(resolve => { finish=resolve; }), started = new Promise<void>(resolve => { entered=resolve; });
  const query = createPluginStoragePolicy("owner",life,async()=>{ if(delay){entered();await gate;}return usage; });
  const policy = await query();
  expect(policy.usage).toEqual(usage);
  expect(policy.kv).toMatchObject({roaming:"preference-events",maxBytes:null,uninstall:"retain"});
  expect(policy.documents).toMatchObject({roaming:"none",maxBytes:null,putMaxDocumentBytes:null,applyMaxDocumentBytes:4194304,applyMaxBatchBytes:8388608});
  expect(policy.secrets).toMatchObject({backup:"excluded",usage:null,roaming:"none"});
  expect(policy.syncStatus).toBe("not-measured");
  policy.kv.localOnlyKeys.push("forged");expect((await query()).kv.localOnlyKeys).not.toContain("forged");
  delay=true;const pending=query();await started;life.stop();
  await expect(pending).rejects.toMatchObject({code:"plugin/cancelled"});finish();await life.drainCleanups();
  expect(()=>query()).toThrow();
});
