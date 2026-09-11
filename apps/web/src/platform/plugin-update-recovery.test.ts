import { expect, test } from "bun:test";

if (process.env.PLUGIN_RECOVERY_BOOT === "1") {
  let resolve!: (value: unknown) => void;
  let failure: unknown;
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: (command: string) => {
      calls.push(command);
      if (failure) return Promise.reject(failure);
      return new Promise(value => { resolve = value; });
    },
  } } });
  const { recoverPluginUpdates } = await import("./plugin-update-recovery");
  const { withPluginDataWrites } = await import("./plugin-data-access");
  const { PluginPreferencePublication } = await import("./plugin-preference-publication");

  test("boot awaits native recovery status and quarantines only unresolved owners without triggering live rollback", async () => {
    let complete = false;
    const boot = recoverPluginUpdates().then(() => { complete = true; });
    await Bun.sleep(0); expect(complete).toBe(false);
    expect(calls).toEqual(["plugins_recovery_status"]);
    resolve([{ pluginId: "interrupted", code: "plugin/recovery-required" }]); await boot;
    expect(PluginPreferencePublication.blocks("read-aware-plugin.interrupted.settings")).toBe(true);
    await expect(withPluginDataWrites(["interrupted"], () => {})).rejects.toMatchObject({ code: "plugin/recovery-required" });
    await withPluginDataWrites(["healthy"], () => {});
    expect(calls).toEqual(["plugins_recovery_status"]);
  });

  test("unreadable recovery state fails boot instead of pretending there are no unresolved updates", async () => {
    failure = { code: "db/locked", message: "recovery metadata unavailable" };
    await expect(recoverPluginUpdates()).rejects.toMatchObject({ code: "db/locked" });
  });
} else {
  test("isolated plugin recovery boot boundary", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, PLUGIN_RECOVERY_BOOT: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("2 pass");
  }, 30_000);
}
