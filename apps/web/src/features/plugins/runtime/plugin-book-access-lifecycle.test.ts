import { expect, spyOn, test } from "bun:test";
import type { SandboxedPlugin } from "./plugin-worker-host";

if (process.env.PLUGIN_BOOK_ACCESS_LIFECYCLE === "1") {
  const disk = new Map<string, string>();
  const accessKey = "read-aware-plugins-book-access";
  let holdGrant = false, failGrant = false;
  let releaseGrant: (() => void) | undefined;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {}, __TAURI_INTERNALS__: {
    invoke: async (command: string, args: any) => {
      if (command === "set_kv") {
        if (args.key === accessKey && holdGrant) await new Promise<void>(resolve => { releaseGrant = resolve; });
        if (args.key === accessKey && failGrant) throw { code: "db/locked", message: "Injected grant write failure" };
        disk.set(args.key, args.value);
      }
      if (command === "delete_kv") disk.delete(args.key);
      if (command === "desktop_startup_enabled") return false;
    },
  } } });
  const worker = await import("./plugin-worker-host");
  const { getDefaultStore } = await import("jotai");
  const { localKV } = await import("../../../platform/local-store");
  const { installedPluginsAtom, getPluginBookAccess, persistPluginBookAccess } = await import("../state/plugin-store");
  const host = await import("./plugin-host");
  const tick = () => Bun.sleep(0);

  test("grant changes drain old execution and await durability before restarting", async () => {
    const id = "book-grant-proof";
    const manifest = { id, name: "Book grant proof", version: "1.0.0", schemaVersion: 1, requires: {} };
    const starts: unknown[] = [];
    let holdStop = true, releaseStop!: () => void;
    spyOn(worker, "startPluginWorker").mockImplementation(async (_manifest, _version, _disposables, options) => {
      starts.push(options?.bookAccess);
      return {
        hasMigration: false, checkHealth: async () => {}, promote: () => {},
        terminate: async () => { if (holdStop) await new Promise<void>(resolve => { releaseStop = resolve; }); },
      } as unknown as SandboxedPlugin;
    });
    await localKV.setItemAsync(`read-aware-plugin-host.schema.${id}`, "1");
    getDefaultStore().set(installedPluginsAtom, [{ manifest, enabled: false }]);
    await host.setPluginEnabled(id, true);
    expect(starts).toEqual([{ mode: "all" }]);

    holdGrant = true;
    const change = host.updatePluginBookAccess(id, { mode: "book", bookId: "A" });
    await tick();
    expect(getPluginBookAccess(id).grant).toEqual({ mode: "all" });
    expect(starts).toHaveLength(1);
    await expect(host.setPluginEnabled(id, true)).rejects.toMatchObject({ code: "plugin/data-busy" });
    holdStop = false; releaseStop(); await tick();
    expect(releaseGrant).toBeDefined();
    expect(starts).toHaveLength(1);
    expect(getDefaultStore().get(installedPluginsAtom)[0]?.bookAccess).toBeUndefined();
    holdGrant = false; releaseGrant!(); await change;
    expect(starts).toEqual([{ mode: "all" }, { mode: "book", bookId: "A" }]);
    expect(JSON.parse(disk.get(accessKey)!)[id]).toEqual({ mode: "book", bookId: "A" });

    failGrant = true;
    await expect(host.updatePluginBookAccess(id, { mode: "book", bookId: "B" })).rejects.toMatchObject({ code: "db/locked" });
    expect(starts).toHaveLength(2);
    expect(getPluginBookAccess(id).grant).toEqual({ mode: "book", bookId: "A" });
    expect(getDefaultStore().get(installedPluginsAtom)[0]?.error).toBeTruthy();
    failGrant = false;
    await host.setPluginEnabled(id, true);
    holdStop = true;
    const disabling = host.setPluginEnabled(id, false);
    await tick();
    const afterDisable = host.updatePluginBookAccess(id, { mode: "current" });
    await tick();
    expect(getPluginBookAccess(id).grant).toEqual({ mode: "book", bookId: "A" });
    holdStop = false; releaseStop();
    await Promise.all([disabling, afterDisable]);
    expect(getPluginBookAccess(id).grant).toEqual({ mode: "current" });
    expect(starts).toHaveLength(3);
  });

  test("failed teardown cannot be bypassed by retrying a grant change or activation", async () => {
    const id = "book-grant-stuck";
    const manifest = { id, name: "Stuck grant proof", version: "1.0.0", schemaVersion: 1, requires: {} };
    let starts = 0;
    spyOn(worker, "startPluginWorker").mockImplementation(async () => {
      starts++;
      return { hasMigration: false, checkHealth: async () => {}, promote: () => {},
        terminate: async () => { throw new Error("Termination was not confirmed"); },
      } as unknown as SandboxedPlugin;
    });
    await localKV.setItemAsync(`read-aware-plugin-host.schema.${id}`, "1");
    getDefaultStore().set(installedPluginsAtom, [{ manifest, enabled: false }]);
    await host.setPluginEnabled(id, true);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(host.updatePluginBookAccess(id, { mode: "book", bookId: "A" })).rejects.toThrow("Termination was not confirmed");
    }
    await host.setPluginEnabled(id, true);
    expect(starts).toBe(1);
    expect(getPluginBookAccess(id).grant).toEqual({ mode: "all" });
  });

  test("saved grants are copied, serialized across plugins and invalid records fail closed", async () => {
    const grant = { mode: "book" as const, bookId: "A" };
    const first = persistPluginBookAccess("first", grant);
    grant.bookId = "mutated";
    const second = persistPluginBookAccess("second", { mode: "current" });
    await Promise.all([first, second]);
    expect(getPluginBookAccess("first").grant).toEqual({ mode: "book", bookId: "A" });
    expect(getPluginBookAccess("second").grant).toEqual({ mode: "current" });
    expect(getPluginBookAccess("absent")).toEqual({ grant: { mode: "all" }, source: "legacy-domain" });
    await localKV.setItemAsync(accessKey, JSON.stringify({ invalid: { mode: "book", bookId: "" } }));
    expect(() => getPluginBookAccess("invalid")).toThrow();
    await localKV.setItemAsync(accessKey, "[]");
    expect(() => getPluginBookAccess("absent")).toThrow();
  });

} else {
  test("isolated plugin book grant lifecycle", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PLUGIN_BOOK_ACCESS_LIFECYCLE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
  }, 30_000);
}
