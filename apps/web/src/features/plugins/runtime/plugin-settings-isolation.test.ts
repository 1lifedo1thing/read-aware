import type { PluginUpdateJournal } from "./plugin-update-journal";
import type { SandboxedPlugin } from "./plugin-worker-host";
import { expect, spyOn, test } from "bun:test";

if (process.env.PLUGIN_SETTINGS_ISOLATION === "1") {
  const { getDefaultStore } = await import("jotai");
  const worker = await import("./plugin-worker-host");
  const { installedPluginsAtom } = await import("../state/plugin-store");
  const { localKV } = await import("../../../platform/local-store");
  const { buildPluginSettingsView } = await import("../lib/plugin-settings");
  const { createSettingsDomain } = await import("../../../domain/settings/domain");
  const { withPluginDataBackup, withPluginDataUpdate } = await import("../../../platform/plugin-data-access");
  const { describeError } = await import("../../../i18n/describe-error");
  const { initI18n } = await import("../../../i18n");
  const { AppError } = await import("@read-aware/core");
  const tick = () => Bun.sleep(0);
  const gate = () => { let release!: () => void; return { promise: new Promise<void>(r => { release = r; }), resolve: () => release() }; };
  const disk = new Map<string, string>(); const commands: string[] = [];
  const publications: { payload: { key: string; value: unknown } }[][] = [];
  const id = "settings-update-proof", settingsKey = `read-aware-plugin.${id}.settings`, schemaKey = `read-aware-plugin-host.schema.${id}`;
  const manifest = { id, name: "Settings update proof", version: "1.0.0", schemaVersion: 1, requires: {},
    settings: [{ kind: "toggle" as const, id: "enabled", label: "Enabled", value: false }] };
  let candidate = { ...manifest, version: "2.0.0", schemaVersion: 2 };
  let rows: { key: string; valueJson: string }[] = []; let holdKV = false; let failPublication = false; let loseAcceptReply = false; let loseBeginReply = false; let driftBeforeAccept = false;
  const journals = new Map<string, PluginUpdateJournal>();
  const snapshot = () => ({ pluginId: id, kv: Object.fromEntries([...disk].filter(([key]) => key.startsWith(`read-aware-plugin.${id}.`)).map(([key,value]) => [key.slice(`read-aware-plugin.${id}.`.length),value])), documents: [], schema: disk.get(schemaKey) ?? null });
  const writes: ((error?: unknown) => void)[] = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string, args: any) => {
      commands.push(command);
      if (command === "set_kv" || command === "delete_kv") {
        const commit = () => { if (command === "set_kv") disk.set(args.key, args.value); else disk.delete(args.key); };
        if (holdKV) return new Promise<void>((resolve, reject) => writes.push(error => { if (error) reject(error); else { commit(); resolve(); } }));
        commit(); return;
      }
      if (command === "local_device_get") return { deviceId: "update-proof", lastHlcWallMs: null, lastHlcCounter: null };
      if (command === "preferences_load_all") return structuredClone(rows);
      if (command === "commit_events") {
        if (failPublication) throw { code: "db/locked", message: "event log unavailable" };
        publications.push(structuredClone(args.events));
        for (const event of args.events) if (event.type === "preference.changed") {
          rows = [...rows.filter(row => row.key !== event.payload.key), { key: event.payload.key, valueJson: JSON.stringify(event.payload.value) }];
        }
        return { appended: args.events.length, applied: args.events.length };
      }
      if (command === "plugins_update_begin") {
        const journal: PluginUpdateJournal = { updateId: args.updateId, pluginId: id, candidateToken: args.candidateToken,
          hadPrevious: args.candidateToken ? true : null, baseline: snapshot(), phase: "prepared", accepted: null };
        journals.set(journal.updateId, journal);
        if (loseBeginReply) { loseBeginReply = false; throw { code: "ipc/unknown", message: "reply lost after preparation" }; }
        return structuredClone(journal);
      }
      if (command === "plugins_update_get") return structuredClone(journals.get(args.updateId) ?? null);
      if (command === "plugins_update_accept") {
        const journal = journals.get(args.updateId)!;
        if (journal.phase === "prepared") {
          if (driftBeforeAccept) {
            driftBeforeAccept = false;
            await localKV.setItemAsync(`read-aware-plugin.${id}.raced`, "true");
            throw { code: "plugin/data-busy", message: "source changed before decision" };
          }
          if (failPublication) throw { code: "db/locked", message: "event log unavailable" };
          publications.push(structuredClone(args.events));
          for (const event of args.events) rows = [...rows.filter(row => row.key !== event.payload.key), { key: event.payload.key, valueJson: JSON.stringify(event.payload.value) }];
          journal.phase = "accepted"; journal.accepted = snapshot();
          if (loseAcceptReply) { loseAcceptReply = false; throw { code: "ipc/unknown", message: "reply lost after commit" }; }
        }
        return structuredClone(journal);
      }
      if (command === "plugins_update_finish") { journals.delete(args.updateId); return; }
      if (command === "plugins_update_rollback") {
        const journal = journals.get(args.updateId)!;
        if (journal.phase === "accepted") throw { code: "plugin/recovery-required", message: "already accepted" };
        for (const key of disk.keys()) if (key.startsWith(`read-aware-plugin.${id}.`) || key === schemaKey) disk.delete(key);
        for (const [key,value] of Object.entries(journal.baseline.kv)) disk.set(`read-aware-plugin.${id}.${key}`, value);
        if (journal.baseline.schema !== null) disk.set(schemaKey,journal.baseline.schema);
        journals.delete(args.updateId); return;
      }
      if (command === "plugins_stage_files") return { id, token: "candidate-proof", manifest: JSON.stringify(candidate) };
      if (command === "plugins_commit_candidate") return { id, manifest: JSON.stringify(candidate) };
      if (command === "plugin_data_snapshot") return snapshot();
      if (command === "desktop_startup_enabled") return false;
    },
  } } });

  test("production host update blocks external settings through rollback and restart", async () => {
    const migration = gate(), teardown = gate(); const starts: number[] = []; const grants: unknown[] = [];
    spyOn(worker, "startPluginWorker").mockImplementation(async (input, _version, _disposables, options) => {
      starts.push(input.schemaVersion); grants.push(options?.bookAccess);
      return {
        hasMigration: true, checkHealth: async () => {}, promote: () => {},
        migrate: async () => { await localKV.setItemAsync(settingsKey, '{"candidate":true}'); await migration.promise; throw new Error("migration failed"); },
        terminate: async () => { if (input.schemaVersion === 2) await teardown.promise; },
      } as unknown as SandboxedPlugin;
    });
    const host = await import("./plugin-host");
    await localKV.setItemAsync(schemaKey, "1"); await localKV.setItemAsync(settingsKey, '{"enabled":true}');
    getDefaultStore().set(installedPluginsAtom, [{ manifest, enabled: false }]);
    await host.setPluginEnabled(id, true);
    const oldForm = buildPluginSettingsView(manifest)!;
    publications.length = 0;
    const update = host.installPluginFiles(id, [], { mode: "book", bookId: "A" }).catch(error => error);
    await tick(); expect(localKV.getItem(settingsKey)).toBe('{"candidate":true}');
    expect(publications).toEqual([]);
    await expect(Promise.resolve(oldForm.onSubmit({ enabled: false }))).rejects.toMatchObject({ code: "plugin/data-busy" });
    await expect(createSettingsDomain("agent").commands.update([{ path: `plugins.${id}.enabled`, value: false }])).rejects.toMatchObject({ code: "plugin/data-busy" });
    migration.resolve(); await tick(); expect(commands).not.toContain("plugins_update_rollback");
    teardown.resolve(); expect((await update).message).toContain("migration failed");
    expect(commands).toContain("plugins_update_rollback"); expect(starts).toEqual([1, 2, 1]);
    expect(grants).toEqual([{ mode: "all" }, { mode: "book", bookId: "A" }, { mode: "all" }]);
    expect(publications).toEqual([]);
    expect(localKV.getItem(settingsKey)).toBe('{"enabled":true}'); expect(disk.get(settingsKey)).toBe('{"enabled":true}');
    await expect(Promise.resolve(oldForm.onSubmit({ enabled: false }))).rejects.toMatchObject({ code: "plugin/settings-stale" });
    await buildPluginSettingsView(manifest)!.onSubmit({ enabled: false });
    expect(disk.get(settingsKey)).toBe('{"enabled":false}');
    await host.setPluginEnabled(id, false);
  });

  test("production host publishes one final net-change batch after accepting the candidate", async () => {
    const migration = gate(); const prefix = `read-aware-plugin.${id}.`;
    await localKV.setItemAsync(prefix + "obsolete", "true");
    await localKV.setItemAsync(prefix + "steady", "1"); await tick();
    publications.length = 0;
    spyOn(worker, "startPluginWorker").mockImplementation(async () => ({
      hasMigration: true, checkHealth: async () => {}, promote: () => {}, terminate: async () => {},
      migrate: async () => {
        await localKV.setItemAsync(settingsKey, '{"temporary":true}');
        await localKV.setItemAsync(prefix + "transient", "true");
        await migration.promise;
        await localKV.removeItemAsync(prefix + "transient");
        await localKV.removeItemAsync(prefix + "obsolete");
        await localKV.setItemAsync(prefix + "steady", "1");
        await localKV.setItemAsync(settingsKey, '{"enabled":true}');
      },
    }) as unknown as SandboxedPlugin);
    const host = await import("./plugin-host");
    const install = host.installPluginFiles(id, []);
    await tick(); expect(publications).toEqual([]);
    const roaming = await import("../../../platform/roaming-preferences");
    roaming.publishRoamingPreference(prefix + "settings", { backfill: "must not escape" });
    await tick(); expect(publications).toEqual([]);
    migration.resolve(); expect((await install).manifest.version).toBe("2.0.0"); await tick();
    expect(publications).toHaveLength(1);
    expect(publications[0]!.map(event => event.payload)).toEqual([
      { key: prefix + "obsolete", value: null }, { key: settingsKey, value: { enabled: true } },
    ]);
    await localKV.setItemAsync(settingsKey, '{"afterAcceptance":true}'); await tick();
    expect(publications.at(-1)?.[0]?.payload.value).toEqual({ afterAcceptance: true });
    await host.setPluginEnabled(id, false);
  });

  test("atomic acceptance failure rolls back; a lost accepted reply is resolved without rollback or double publication", async () => {
    candidate = { ...candidate, version: "3.0.0", schemaVersion: 3 };
    spyOn(worker, "startPluginWorker").mockImplementation(async () => ({
      hasMigration: true, checkHealth: async () => {}, promote: () => {}, terminate: async () => {},
      migrate: async () => { await localKV.setItemAsync(settingsKey, '{"accepted":3}'); },
    }) as unknown as SandboxedPlugin);
    const host = await import("./plugin-host");
    const before = disk.get(settingsKey);
    failPublication = true;
    await expect(host.installPluginFiles(id, [])).rejects.toMatchObject({ code: "db/locked" });
    expect(disk.get(settingsKey)).toBe(before);
    expect(getDefaultStore().get(installedPluginsAtom)[0]?.manifest.version).toBe("2.0.0");
    expect(journals.size).toBe(0);
    failPublication = false; loseBeginReply = true; loseAcceptReply = true; driftBeforeAccept = true;
    const restored = commands.filter(command => command === "plugins_update_rollback").length;
    publications.length = 0;
    expect((await host.installPluginFiles(id, [])).manifest.version).toBe("3.0.0");
    expect(commands.filter(command => command === "plugins_update_rollback")).toHaveLength(restored);
    expect(commands).toContain("plugins_update_get"); expect(publications).toHaveLength(1);
    expect(publications[0]!.some(event => event.payload.key.endsWith(".raced") && event.payload.value === true)).toBe(true);
    expect(disk.get(settingsKey)).toBe('{"accepted":3}'); expect(journals.size).toBe(0);
    await host.setPluginEnabled(id, false);
  });

  test("production installation during backup rejects before runtime or file mutation and discards its candidate", async () => {
    const host = await import("./plugin-host");
    const start = spyOn(worker, "startPluginWorker");
    const starts = start.mock.calls.length;
    const commits = commands.filter(command => command === "plugins_commit_candidate").length;
    const discards = commands.filter(command => command === "plugins_discard_candidate").length;
    await withPluginDataBackup("export", async () => {
      await expect(host.installPluginFiles(id, [])).rejects.toMatchObject({ code: "plugin/data-busy" });
      expect(start.mock.calls.length).toBe(starts);
      expect(commands.filter(command => command === "plugins_commit_candidate")).toHaveLength(commits);
      expect(commands.filter(command => command === "plugins_discard_candidate")).toHaveLength(discards + 1);
    });
  });

  test("activation teardown failure never restores a snapshot under the failed runtime", async () => {
    const restoresBefore = commands.filter(command => command === "plugins_update_rollback").length;
    spyOn(worker, "startPluginWorker").mockImplementation(async () => ({
      hasMigration: true, checkHealth: async () => {}, promote: () => {},
      migrate: async () => { throw new Error("activation migration failed"); },
      terminate: async () => { throw new Error("runtime still draining"); },
    }) as unknown as SandboxedPlugin);
    getDefaultStore().set(installedPluginsAtom, [{ manifest: { ...candidate, schemaVersion: 4 }, enabled: false }]);
    const host = await import("./plugin-host");
    await host.setPluginEnabled(id, true);
    expect(commands.filter(command => command === "plugins_update_rollback")).toHaveLength(restoresBefore);
    expect(getDefaultStore().get(installedPluginsAtom)[0]?.error).toContain("runtime still draining");
    await expect(createSettingsDomain("agent").commands.update([{ path: `plugins.${id}.enabled`, value: false }])).rejects.toMatchObject({ code: "plugin/recovery-required" });
    const removedBefore = commands.filter(command => command === "plugins_uninstall").length;
    await expect(host.uninstallPlugin(id)).rejects.toMatchObject({ code: "plugin/recovery-required" });
    expect(commands.filter(command => command === "plugins_uninstall")).toHaveLength(removedBefore);
    const discardedBefore = commands.filter(command => command === "plugins_discard_candidate").length;
    await expect(host.installPluginFiles(id, [])).rejects.toMatchObject({ code: "plugin/recovery-required" });
    expect(commands.filter(command => command === "plugins_discard_candidate")).toHaveLength(discardedBefore + 1);
    const current = disk.get(settingsKey);
    rows = [{ key: settingsKey, valueJson: '{"unsafeRemote":true}' }, { key: "read-aware-plugin.healthy-recovery.settings", valueJson: '{"healthy":true}' }];
    const roaming = await import("../../../platform/roaming-preferences");
    const before = publications.length; await roaming.refreshRoamingPreferences();
    expect(disk.get(settingsKey)).toBe(current);
    expect(disk.get("read-aware-plugin.healthy-recovery.settings")).toBe('{"healthy":true}');
    expect(publications.slice(before).flat().some(event => event.payload.key.startsWith(`read-aware-plugin.${id}.`))).toBe(false);
  });

  test("roaming waits for updates, reloads current projections and retains admission until physical KV completion", async () => {
    const roaming = await import("../../../platform/roaming-preferences");
    const migrating = gate(); const owner = "roaming-update-proof", key = `read-aware-plugin.${owner}.settings`;
    rows = [{ key, valueJson: '{"version":"stale"}' }];
    const update = withPluginDataUpdate(owner, () => migrating.promise);
    const refresh = roaming.refreshRoamingPreferences(); await tick();
    expect(localKV.getItem(key)).toBeNull();
    rows = [{ key, valueJson: '{"version":"fresh"}' }]; holdKV = true;
    migrating.resolve(); await update; await tick(); expect(writes).toHaveLength(1);
    let entered = false; const following = withPluginDataUpdate(owner, async () => { entered = true; });
    await tick(); expect(entered).toBe(false);
    writes.shift()!(); await refresh; await following; holdKV = false;
    expect(localKV.getItem(key)).toBe('{"version":"fresh"}'); expect(disk.get(key)).toBe('{"version":"fresh"}');
  });

  test("a failed remote namespace does not release another namespace with native writes still pending", async () => {
    const roaming = await import("../../../platform/roaming-preferences");
    rows = ["remote-first", "remote-second"].map(owner => ({ key: `read-aware-plugin.${owner}.settings`, valueJson: '{"enabled":true}' }));
    holdKV = true;
    const refresh = roaming.refreshRoamingPreferences(); await tick();
    let entered = false;
    const update = withPluginDataUpdate("remote-second", async () => { entered = true; });
    writes.shift()!({ code: "db/locked", message: "first namespace failed" });
    await tick(); expect(writes).toHaveLength(1); expect(entered).toBe(false);
    writes.shift()!(); await refresh; await update; holdKV = false;
    expect(disk.get("read-aware-plugin.remote-second.settings")).toBe('{"enabled":true}');
  });

  test("settings migration errors have localized copy and honest retry semantics", async () => {
    await initI18n("en");
    for (const code of ["plugin/data-busy", "plugin/settings-stale", "plugin/recovery-required"]) {
      const description = describeError(new AppError(code, "PRIVATE_SCHEMA_FAILURE"));
      expect(description.body).not.toContain("PRIVATE_SCHEMA_FAILURE");
      expect(description.retryable).toBe(code === "plugin/data-busy");
    }
    for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
      const common = await Bun.file(new URL(`../../../i18n/locales/${locale}/common.json`, import.meta.url)).json();
      expect(common.errors.pluginRecoveryRequired).toBeTruthy(); expect(common.errors.pluginDataBusy).toBeTruthy(); expect(common.errors.pluginSettingsStale).toBeTruthy();
    }
  });
} else {
  test("isolated host settings migration and roaming boundary", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, PLUGIN_SETTINGS_ISOLATION: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("8 pass");
  }, 30_000);
}
