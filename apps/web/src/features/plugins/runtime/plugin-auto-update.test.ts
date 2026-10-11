import type { PluginUpdateJournal } from "./plugin-update-journal";
import type { SandboxedPlugin } from "./plugin-worker-host";
import { expect, spyOn, test } from "bun:test";

if (process.env.PLUGIN_AUTO_UPDATE === "1") {
  const { getDefaultStore } = await import("jotai");
  const worker = await import("./plugin-worker-host");
  const { installedPluginsAtom } = await import("../state/plugin-store");
  const { localKV } = await import("../../../platform/local-store");
  const { setPluginToastHandler } = await import("../lib/plugin-toast");
  const { initI18n } = await import("../../../i18n");
  const { ERR_PLUGIN_APP_UPDATE_REQUIRED, ERR_PLUGIN_UPDATE_REQUIRED, AppError } = await import("@read-aware/core");
  await initI18n("en");

  const settingsAccess = { discover: ["appearance.theme"], write: ["appearance.theme"] };
  const base = { name: "Theme Schedule", schemaVersion: 1, settingsAccess };
  const installed = (id: string, version: string, enabled: boolean) => ({
    manifest: { id, version, ...base, requires: { services: { storage: "^1.0.0" } } },
    enabled,
    ...(enabled ? { error: new AppError(ERR_PLUGIN_UPDATE_REQUIRED, "storage ^1.0.0 vs 2.x") } : {}),
  });
  const release = (id: string, version: string, patch: Record<string, unknown> = {}) => ({
    id,
    version,
    ...base,
    requires: { services: { storage: "^2.0.0" } },
    ...patch,
  });

  const commands: string[] = [];
  const journals = new Map<string, PluginUpdateJournal>();
  let commitGate: Promise<void> | null = null;
  let failCommit = false;
  let registry: Array<Record<string, unknown>> = [];
  let releases = new Map<string, Record<string, unknown>>();
  const toasts: string[] = [];
  setPluginToastHandler((toast) => toasts.push(toast.kind === "notice" ? toast.message : "failure"));

  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: any) => {
          commands.push(command);
          if (command === "plugin:app|version") return "0.6.5";
          if (command === "set_kv" || command === "delete_kv" || command === "set_kv_batch") return;
          if (command === "local_device_get")
            return { deviceId: "auto-update", lastHlcWallMs: null, lastHlcCounter: null };
          if (command === "preferences_load_all") return [];
          if (command === "commit_events") return { appended: args.events.length, applied: args.events.length };
          if (command === "plugin_data_snapshot") return { pluginId: args.id, kv: {}, documents: [], schema: null };
          if (command === "plugins_stage_files") {
            const manifest = args.files.find((file: { path: string }) => file.path === "manifest.json").content;
            return { id: args.id, token: `candidate:${args.id}`, manifest };
          }
          if (command === "plugins_update_begin") {
            const journal: PluginUpdateJournal = {
              updateId: args.updateId,
              pluginId: args.pluginId,
              candidateToken: args.candidateToken,
              hadPrevious: true,
              baseline: { pluginId: args.pluginId, kv: {}, documents: [], schema: null },
              phase: "prepared",
              accepted: null,
            };
            journals.set(journal.updateId, journal);
            return structuredClone(journal);
          }
          if (command === "plugins_update_get") return structuredClone(journals.get(args.updateId) ?? null);
          if (command === "plugins_commit_candidate") {
            await commitGate;
            if (failCommit) throw { code: "fs/no-space", message: "disk full" };
            const id = args.token.slice("candidate:".length);
            return { id, manifest: JSON.stringify(releases.get(id)) };
          }
          if (command === "plugins_update_accept") {
            const journal = journals.get(args.updateId)!;
            journal.phase = "accepted";
            journal.accepted = journal.baseline;
            return structuredClone(journal);
          }
          if (command === "plugins_update_finish" || command === "plugins_update_rollback") {
            journals.delete(args.updateId);
            return;
          }
          if (command === "plugins_discard_candidate") return;
          if (command === "desktop_startup_enabled") return false;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => {
      const path = String(url).replace(/^https:\/\/[^/]+\/[^/]+\/[^/@]+(?:@main|\/main)\//, "");
      if (path === "registry.json") return new Response(JSON.stringify({ plugins: registry }));
      const manifest = /^plugins\/([^/]+)\/manifest\.json$/.exec(path);
      if (manifest && releases.has(manifest[1]!)) return new Response(JSON.stringify(releases.get(manifest[1]!)));
      if (/^plugins\/[^/]+\/main\.js$/.test(path)) return new Response("export default {}");
      return new Response("missing", { status: 404 });
    },
  });

  const starts: string[] = [];
  spyOn(worker, "startPluginWorker").mockImplementation(async (input) => {
    starts.push(`${input.id}@${input.version}`);
    return {
      hasMigration: false,
      checkHealth: async () => {},
      promote: () => {},
      migrate: async () => {},
      terminate: async () => {},
    } as unknown as SandboxedPlugin;
  });
  const host = await import("./plugin-host");
  const { updatePluginsFromMarketplace } = await import("./plugin-updates");
  const plugins = () => getDefaultStore().get(installedPluginsAtom);
  const reset = (list: unknown[]) => {
    getDefaultStore().set(installedPluginsAtom, list as never);
    commands.length = 0;
    starts.length = 0;
    toasts.length = 0;
    localKV.removeItem("read-aware-plugin-update-check");
  };

  test("a disabled plugin gets its files replaced without running any of its code", async () => {
    releases = new Map([["theme-schedule", release("theme-schedule", "1.1.0")]]);
    reset([installed("theme-schedule", "1.0.1", false)]);
    const updated = await host.updatePluginFiles("theme-schedule", [
      { path: "manifest.json", content: JSON.stringify(releases.get("theme-schedule")) },
    ]);
    expect(starts).toEqual([]);
    expect(updated).toMatchObject({ enabled: false, manifest: { version: "1.1.0" } });
    expect(plugins()[0]).toMatchObject({ enabled: false, manifest: { version: "1.1.0" } });
    expect(commands.filter((command) => command.startsWith("plugins_"))).toEqual([
      "plugins_stage_files",
      "plugins_update_begin",
      "plugins_commit_candidate",
      "plugins_update_accept",
      "plugins_update_finish",
      "plugins_discard_candidate",
    ]);
  });

  test("a disabled plugin keeps its files when the release cannot run or the commit fails", async () => {
    releases = new Map([["theme-schedule", release("theme-schedule", "2.0.0", { minAppVersion: "99.0.0" })]]);
    reset([installed("theme-schedule", "1.0.1", false)]);
    const payload = [{ path: "manifest.json", content: JSON.stringify(releases.get("theme-schedule")) }];
    await expect(host.updatePluginFiles("theme-schedule", payload)).rejects.toMatchObject({
      code: ERR_PLUGIN_APP_UPDATE_REQUIRED,
    });
    expect(commands).not.toContain("plugins_commit_candidate");
    expect(commands).toContain("plugins_discard_candidate");

    releases = new Map([["theme-schedule", release("theme-schedule", "1.1.0")]]);
    reset([installed("theme-schedule", "1.0.1", false)]);
    failCommit = true;
    await expect(
      host.updatePluginFiles("theme-schedule", [
        { path: "manifest.json", content: JSON.stringify(releases.get("theme-schedule")) },
      ]),
    ).rejects.toMatchObject({ code: "fs/no-space" });
    failCommit = false;
    expect(commands).toContain("plugins_update_rollback");
    expect(commands).not.toContain("plugins_update_accept");
    expect(plugins()[0]?.manifest.version).toBe("1.0.1");
  });

  test("enabling a plugin mid-replacement starts the replaced version", async () => {
    releases = new Map([["theme-schedule", release("theme-schedule", "1.1.0")]]);
    reset([installed("theme-schedule", "1.0.1", false)]);
    let release_!: () => void;
    commitGate = new Promise((resolve) => {
      release_ = resolve;
    });
    const replacing = host.updatePluginFiles("theme-schedule", [
      { path: "manifest.json", content: JSON.stringify(releases.get("theme-schedule")) },
    ]);
    while (!commands.includes("plugins_commit_candidate")) await Bun.sleep(0);
    const enabling = host.setPluginEnabled("theme-schedule", true);
    await Bun.sleep(5);
    expect(starts).toEqual([]);
    release_();
    commitGate = null;
    await replacing;
    await enabling;
    expect(starts).toEqual(["theme-schedule@1.1.0"]);
    expect(plugins()[0]).toMatchObject({ enabled: true, manifest: { version: "1.1.0" } });
    expect(plugins()[0]?.error).toBeUndefined();
    await host.setPluginEnabled("theme-schedule", false);
  });

  test("the updater applies same-authority releases and holds wider ones for consent", async () => {
    releases = new Map([
      ["theme-schedule", release("theme-schedule", "1.1.0")],
      // Asks to write a setting it never had: needs the user's consent.
      ["wider", release("wider", "2.0.0", { settingsAccess: { write: ["appearance.theme", "reading.theme"] } })],
      // Needs a newer app: the installed version keeps working.
      ["future", release("future", "3.0.0", { minAppVersion: "99.0.0" })],
    ]);
    registry = [...releases.values()].map(({ id, name, version }) => ({ id, name, version }));
    reset([
      installed("theme-schedule", "1.0.1", true),
      installed("wider", "1.0.0", false),
      installed("future", "1.0.0", false),
    ]);
    await updatePluginsFromMarketplace();
    const byId = new Map(plugins().map((plugin) => [plugin.manifest.id, plugin]));
    // The enabled, broken plugin went through the blue-green path and now runs.
    expect(starts).toEqual(["theme-schedule@1.1.0"]);
    expect(byId.get("theme-schedule")).toMatchObject({ enabled: true, manifest: { version: "1.1.0" } });
    expect(byId.get("theme-schedule")?.error).toBeUndefined();
    expect(byId.get("wider")?.manifest.version).toBe("1.0.0");
    expect(byId.get("future")?.manifest.version).toBe("1.0.0");
    expect(toasts).toEqual([
      "Theme Schedule updated to v1.1.0",
      "Theme Schedule v2.0.0 asks for new permissions — review it in Settings → Plugins → Marketplace",
    ]);

    // Same day, same app version, nothing broken: no second check.
    commands.length = 0;
    toasts.length = 0;
    await updatePluginsFromMarketplace();
    expect(commands.filter((command) => command.startsWith("plugins_"))).toEqual([]);
    expect(toasts).toEqual([]);
    await host.setPluginEnabled("theme-schedule", false);
  });
} else {
  test("isolated plugin auto-update", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PLUGIN_AUTO_UPDATE: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("4 pass");
  }, 30_000);
}
