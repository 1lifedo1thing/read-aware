import { expect, mock, test } from "bun:test";
import { AppError } from "@read-aware/core";

const scenario = process.env.DATA_WIPE_CASE;
if (scenario) {
  test(`wipe write admission: ${scenario}`, async () => {
    const { DomainWriteGate } = await import("../../../platform/domain-write-gate");
    const gate = new DomainWriteGate();
    const native = Promise.withResolvers<void>(), accepted = Promise.withResolvers<void>();
    let syncPaused = false, pluginsPaused = false, calls = 0, cleared = 0;
    mock.module("../../../platform/environment", () => ({ isTauri: () => true }));
    mock.module("../../../platform/sync/sync-scheduler", () => ({
      syncRelayClient: () => ({ logout: async () => { throw Error("offline"); } }),
      withSyncBackup: async (run: () => Promise<unknown>) => {
        syncPaused = true; try { return await run(); } finally { syncPaused = false; }
      },
    }));
    mock.module("../../../platform/plugin-data-access", () => ({ withPluginDataBackup: async (_mode: string, run: () => Promise<unknown>) => {
      pluginsPaused = true; try { return await run(); } finally { pluginsPaused = false; }
    } }));
    mock.module("./backup-capture", () => ({ withBackupCapture: (run: () => Promise<unknown>) => gate.withPaused(run) }));
    mock.module("../../../platform/clear-webview-storage", () => ({ clearWebviewStorage: async () => { cleared++; } }));
    mock.module("../../../platform/ipc", () => ({ invoke: async (command: string) => {
      if (command === "delete_kv") {
        if (scenario === "ack-fails") throw new AppError("db/error", "acknowledgement failed");
        return;
      }
      expect(command).toBe("wipe_all_data"); calls++; await native.promise;
      if (scenario === "rolled-back" || scenario === "cleanup-pending") throw new AppError(scenario === "rolled-back" ? "db/error" : "data/wipe-incomplete", "synthetic native failure");
    } }));
    const wipe = await import("./delete-all-data");
    const write = gate.run(() => accepted.promise);
    const result = wipe.deleteAllData().catch(error => error);
    await Bun.sleep(0); expect(calls).toBe(0); expect(wipe.getDataWipeState()?.phase).toBe("working");
    accepted.resolve(); await write; await Bun.sleep(0);
    expect(calls).toBe(1);
    await expect(gate.run(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
    native.resolve(); const settled = await result;
    if (scenario === "rolled-back") {
      expect(settled.code).toBe("db/error"); expect(wipe.getDataWipeState()).toBeNull();
      expect(syncPaused).toBe(false); expect(pluginsPaused).toBe(false); expect(cleared).toBe(0);
      await gate.run(async () => {});
    } else {
      if (scenario === "complete") expect(settled).toBeUndefined();
      else expect(settled.code).toBe("data/wipe-incomplete");
      expect(wipe.getDataWipeState()?.phase).toBe("reload-required");
      expect(syncPaused).toBe(true); expect(pluginsPaused).toBe(true); expect(cleared).toBe(1);
      await expect(gate.run(async () => {})).rejects.toMatchObject({ code: "backup/busy" });
      await expect(wipe.deleteAllData()).rejects.toMatchObject({ code: "backup/busy" });
      expect(calls).toBe(1);
    }
  });
} else {
  for (const name of ["rolled-back", "cleanup-pending", "ack-fails", "complete"]) test(`isolated wipe ${name}`, async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, DATA_WIPE_CASE: name }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text(); expect(await child.exited, output).toBe(0);
  }, 30_000);
}
