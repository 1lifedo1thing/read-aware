import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { PluginDataSnapshot } from "../src/features/plugins/runtime/plugin-data-snapshot";

if (process.env.PLUGIN_DATA_SNAPSHOT_CASE === "1") {
  test("native baseline and joint restore share the KV queue, failures and later edits", async () => {
    const dom = new JSDOM("", { url: "http://localhost" });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
    const calls: string[] = [], disk = new Map<string, string>();
    const prefix = "read-aware-plugin.sample.", schema = "read-aware-plugin-host.schema.sample";
    let documents: PluginDataSnapshot["documents"] = [];
    let gate: Promise<void> | undefined, restoreGate: Promise<void> | undefined, fail = false;
    Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: {
      key: string; value: string; pluginId: string; snapshot: PluginDataSnapshot;
    }) => {
      calls.push(command);
      if (command === "set_kv") { await gate; disk.set(args.key, args.value); return; }
      if (command === "delete_kv") { disk.delete(args.key); return; }
      if (command === "plugin_data_snapshot") return { pluginId: args.pluginId,
        kv: Object.fromEntries([...disk].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value])),
        schema: disk.get(schema) ?? null, documents: structuredClone(documents) };
      if (command === "plugin_data_restore") {
        await restoreGate;
        if (fail) throw { code: "db/error", message: "restore failed" };
        for (const key of disk.keys()) if (key.startsWith(prefix) || key === schema) disk.delete(key);
        for (const [key, value] of Object.entries(args.snapshot.kv)) disk.set(prefix + key, value);
        if (args.snapshot.schema !== null) disk.set(schema, args.snapshot.schema);
        documents = structuredClone(args.snapshot.documents);
        return;
      }
      if (command.startsWith("plugin:log|")) return;
      throw Error(`Unexpected IPC: ${command}`);
    } } });
    const { localKV, onLocalKVCommit } = await import("../src/platform/local-store");
    const { snapshotPluginData, restorePluginData, pluginDataSchemaVersion } = await import("../src/features/plugins/runtime/plugin-data-snapshot");
    const commits: unknown[] = [];
    const stop = onLocalKVCommit(commit => commits.push(commit));
    try {
      let release!: () => void;
      gate = new Promise<void>(resolve => { release = resolve; });
      const write = localKV.setItemAsync(prefix + "setting", "before");
      const capturing = snapshotPluginData("sample");
      await Bun.sleep(0);
      expect(calls).not.toContain("plugin_data_snapshot");
      release(); gate = undefined; await write;
      const baseline = await capturing;
      expect(baseline.kv).toEqual({ setting: "before" });
      expect(baseline.schema).toBeNull();
      await localKV.setItemAsync(prefix + "setting", "candidate");
      await localKV.setItemAsync(prefix + "added", "remove-me");
      await localKV.setItemAsync(schema, "2");
      fail = true;
      const count = commits.length;
      await expect(restorePluginData("sample", baseline)).rejects.toMatchObject({ code: "db/error" });
      expect(commits).toHaveLength(count);
      expect(localKV.getItem(prefix + "setting")).toBe("candidate");
      expect(localKV.getItem(schema)).toBe("2");
      fail = false;
      restoreGate = new Promise<void>(resolve => { release = resolve; });
      const restored = restorePluginData("sample", baseline);
      baseline.kv.setting = "mutated";
      await Bun.sleep(0);
      const later = localKV.setItemAsync(prefix + "setting", "later");
      release(); await restored; await later;
      expect(disk.get(prefix + "setting")).toBe("later");
      expect(localKV.getItem(prefix + "setting")).toBe("later");
      expect(localKV.getItem(prefix + "added")).toBeNull();
      expect(localKV.getItem(schema)).toBeNull();
      expect(commits[count]).toMatchObject({ source: "restore", entries: expect.arrayContaining([{ key: prefix + "setting", value: "before" }]) });
      expect(calls.filter(command => command === "plugin_data_restore")).toHaveLength(2);
      expect(calls).not.toContain("plugin_docs_restore");
      expect(calls).not.toContain("replace_kv_prefix");
      expect(pluginDataSchemaVersion("3")).toBe(3);
      for (const value of [null, "", "2junk", "1.5", "0", "-1", "9007199254740992"]) expect(pluginDataSchemaVersion(value)).toBeNull();
    } finally { stop(); dom.window.close(); }
  });
} else {
  test("plugin data native IPC and KV mirror integration (isolated)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PLUGIN_DATA_SNAPSHOT_CASE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(child.stdout).text() + await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
  });
}
