import { expect, spyOn, test } from "bun:test";

if (process.env.PLUGIN_BACKUP_DATA_PROOF === "1") {
  type Pending = { command: string; resolve(value?: unknown): void; reject(error: unknown): void };
  const pending: Pending[] = [], commands: string[] = [];
  let hold = true;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {}, __TAURI_INTERNALS__: {
    invoke(command: string) {
      commands.push(command);
      if (command === "local_device_get") return Promise.resolve({ deviceId: "plugin-backup", lastHlcWallMs: null, lastHlcCounter: null });
      if (["set_kv", "delete_kv", "secret_set", "secret_delete", "plugin_docs_put", "plugin_docs_delete", "plugin_docs_apply", "commit_events"].includes(command) && hold) {
        return new Promise((resolve, reject) => pending.push({ command, resolve, reject }));
      }
      return Promise.resolve(command === "plugin_docs_apply" ? { status: "applied", documents: [] } : undefined);
    },
  } } });
  const { buildPluginContext } = await import("./plugin-context");
  const { withPluginDataBackup, withPluginDataUpdate } = await import("../../../platform/plugin-data-access");
  const { hostMaintenance } = await import("../../../services/maintenance");
  await import("../../../platform/roaming-preferences");
  const create = (id: string) => buildPluginContext({ id, name: "Backup data proof", version: "1", schemaVersion: 1,
    requires: {}, permissions: [] }, "0.5.4", []);

  test("the initiating plugin's backup read excludes private writes without joining its own request", async () => {
    const runtime = create("backup-data"), late = create("backup-late");
    runtime.lifecycle.promote();
    const { storage, secrets, maintenance } = runtime.context.services;
    const saved = [storage.set("state", { accepted: true }), storage.collection("notes").put("one", { text: "synthetic" }),
      storage.applyDocuments([{ kind: "put", collection: "notes", id: "two", expectedRevision: null, data: "synthetic" }]),
      secrets.set("token", "synthetic")];
    const io = Promise.withResolvers<void>();
    let entered = false;
    const request = spyOn(hostMaintenance, "requestBackup").mockImplementation((action, signal) => withPluginDataBackup(action, async () => {
      entered = true; await io.promise; return { action, status: "exported" as const };
    }, signal));
    const backup = maintenance.requestBackup("export");
    await Bun.sleep(0); expect(entered).toBe(false); expect(pending).toHaveLength(4);
    late.lifecycle.promote();
    const count = commands.length;
    const rejected = [storage.set("later", 1), storage.remove("state"), storage.collection("notes").put("later", 1),
      storage.collection("notes").delete("one"), storage.applyDocuments([{ kind: "delete", collection: "notes", id: "one", expectedRevision: null }]),
      secrets.set("token", "later"), secrets.remove("token"), late.context.services.storage.set("new", 1)];
    for (const write of rejected) await expect(write).rejects.toMatchObject({ code: "backup/busy" });
    expect(commands).toHaveLength(count);
    for (const work of pending.splice(0)) work.resolve(work.command === "plugin_docs_apply" ? { status: "applied", documents: [] } : undefined);
    await Promise.all(saved); await Bun.sleep(0);
    expect(entered).toBe(false); expect(pending.map(work => work.command)).toEqual(["commit_events"]);
    pending.shift()!.resolve({ appended: 1, applied: 1 }); await Bun.sleep(0);
    expect(entered).toBe(true); expect(runtime.lifecycle.phase).toBe("active");
    io.resolve(); expect(await backup).toEqual({ action: "export", status: "exported" });
    hold = false;
    await storage.set("after", true); await secrets.remove("token");
    request.mockRestore(); runtime.lifecycle.stop(); late.lifecycle.stop();
    await runtime.lifecycle.drainStorageWrites(); await runtime.lifecycle.drainCleanups();
    expect(pending).toHaveLength(0);
  });

  test("migration may write its own namespace but cannot overlap backup or gain secret access", async () => {
    hold = false;
    const runtime = create("backup-migration");
    runtime.lifecycle.beginMigration();
    await withPluginDataUpdate("backup-migration", async () => {
      await runtime.context.services.storage.set("schema-data", { migrated: true });
      await runtime.context.services.storage.collection("notes").put("migrated", true);
      await expect(withPluginDataBackup("export", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
      await expect(runtime.context.services.secrets.set("token", "forbidden")).rejects.toThrow();
    });
    runtime.lifecycle.finishMigration(); runtime.lifecycle.promote();
    await withPluginDataBackup("export", async () => {});
    runtime.lifecycle.stop(); await runtime.lifecycle.drainStorageWrites();
  });

  test("stopped-runtime secret writes retain real failure and cancelled backup cannot escape their completion", async () => {
    hold = true;
    const runtime = create("backup-stopped"); runtime.lifecycle.promote();
    const write = runtime.context.services.secrets.set("token", "synthetic").catch(error => error);
    const controller = new AbortController();
    let entered = false, finished = false, drained = false;
    const backup = withPluginDataBackup("import", async () => { entered = true; }, controller.signal)
      .catch(error => { finished = true; return error; });
    runtime.lifecycle.stop();
    const drain = runtime.lifecycle.drainStorageWrites().catch(error => error).finally(() => { drained = true; });
    controller.abort(new Error("cancelled")); await Bun.sleep(0);
    expect(finished).toBe(false); expect(drained).toBe(false); expect(pending).toHaveLength(1);
    pending.shift()!.reject({ code: "db/locked" });
    expect((await write).code).toBe("db/locked"); expect((await drain).code).toBe("db/locked");
    expect((await backup).message).toBe("cancelled"); expect(entered).toBe(false);
    hold = false; await withPluginDataBackup("export", async () => {});
  });
} else {
  test("isolated private data and initiating-plugin backup chain", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PLUGIN_BACKUP_DATA_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("3 pass");
  }, 30_000);
}
