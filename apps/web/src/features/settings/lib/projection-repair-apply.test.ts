import { expect, mock, test } from "bun:test";
if (process.env.PROJECTION_REPAIR_APPLY_CASE === "1") {
  test("repair drains accepted writes, retains all barriers after commit, and releases only rolled-back failure", async () => {
    const { DomainWriteGate } = await import("../../../platform/domain-write-gate");
    const gate = new DomainWriteGate();
    let syncPaused = false, pluginsPaused = false, calls = 0, fail = true;
    let native = Promise.withResolvers<void>();
    mock.module("../../../platform/sync/sync-scheduler", () => ({ withSyncBackup: async (op: () => Promise<unknown>) => {
      syncPaused = true; try { return await op(); } finally { syncPaused = false; }
    } }));
    mock.module("../../../platform/plugin-data-access", () => ({ withPluginDataBackup: async (_mode: string, op: () => Promise<unknown>) => {
      pluginsPaused = true; try { return await op(); } finally { pluginsPaused = false; }
    } }));
    mock.module("./backup-capture", () => ({ withBackupCapture: (op: () => Promise<unknown>, signal?: AbortSignal) => gate.withPaused(op, signal) }));
    mock.module("../../../platform/ipc", () => ({ invoke: async (command: string) => {
      expect(command).toBe("rebuild_projections"); calls++; await native.promise;
      if (fail) throw Error("transaction rolled back");
      return { eventsReplayed: 4, rows: { privateTable: 2 } };
    } }));
    const { applyProjectionRepair } = await import("./projection-repair-apply");
    const accepted = Promise.withResolvers<void>();
    const write = gate.run(() => accepted.promise);
    const repair = applyProjectionRepair().catch(error => error);
    await Bun.sleep(0); expect(calls).toBe(0);
    accepted.resolve(); await write; await Bun.sleep(0);
    expect(calls).toBe(1); await expect(gate.run(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
    native.resolve(); expect((await repair).message).toBe("transaction rolled back");
    expect(syncPaused).toBe(false); expect(pluginsPaused).toBe(false); await gate.run(async () => {});
    fail = false; native = Promise.withResolvers<void>();
    const caller = new AbortController(); const committed = applyProjectionRepair(caller.signal);
    await Bun.sleep(0); caller.abort(); native.resolve(); expect(await committed).toBeUndefined();
    expect(syncPaused).toBe(true); expect(pluginsPaused).toBe(true);
    await expect(gate.run(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
  });
} else {
  test("isolated projection repair write barrier contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PROJECTION_REPAIR_APPLY_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text(); expect(await child.exited, output).toBe(0);
    expect(output).toContain("1 pass");
  }, 30_000);
}
