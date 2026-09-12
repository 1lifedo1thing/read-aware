import { expect, spyOn, test } from "bun:test";

if (process.env.BACKUP_MIGRATIONS_PROOF === "1") {
  type Call = { command: string; args: any };
  type Pending = Call & { resolve(value?: unknown): void; reject(error: unknown): void };
  const calls: Call[] = [], pending: Pending[] = [], holds = new Set<string>();
  const legacy = new Map<string, string>();
  let memoryRows: unknown[] | undefined, closedDatabases = 0, legacyClears = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    get length() { return legacy.size; }, key: (i: number) => [...legacy.keys()][i] ?? null,
    getItem: (key: string) => legacy.get(key) ?? null, removeItem: (key: string) => { legacy.delete(key); },
    clear: () => { legacy.clear(); legacyClears++; },
  } });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    databases: async () => memoryRows ? [{ name: "read-aware-memories" }] : [],
    open: () => {
      const request: any = {};
      queueMicrotask(() => {
        request.result = { close: () => { closedDatabases++; }, transaction: () => ({ objectStore: () => ({ getAll: () => {
          const read: any = {}; queueMicrotask(() => { read.result = memoryRows; read.onsuccess(); }); return read;
        } }) }) }; request.onsuccess();
      });
      return request;
    },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    async invoke(command: string, args: any) {
      calls.push({ command, args });
      if (holds.has(command) || (command === "set_kv" && holds.has(args.key))) return new Promise((resolve, reject) => pending.push({ command, args, resolve, reject }));
      if (command === "reading_time_load") return { totals: [], daily: [], hourly: [] };
      if (command === "reading_sessions_pending") return [];
      if (command === "vocabulary_migrate_to_plugin_documents") return 0;
      return undefined;
    },
  } } });
  const migration = await import("./desktop-import");
  const { hydrateInterimProjections } = await import("./interim-projections");
  const { withDomainBackup } = await import("./domain-write-gate");
  const { durableWrites } = await import("./write-settlement");
  const sync = await import("./sync/sync-scheduler");
  const { deleteAllData } = await import("../features/settings/lib/delete-all-data");
  const tick = () => Bun.sleep(0), flag = "read-aware-migrated-v1";
  const take = (command: string) => {
    const i = pending.findIndex(item => item.command === command);
    expect(i).toBeGreaterThanOrEqual(0); return pending.splice(i, 1)[0]!;
  };

  test("capture rejects legacy import entrypoints before source reads or native writes", async () => {
    const cleared: string[] = [];
    await withDomainBackup(async () => {
      const before = calls.length;
      for (const action of [migration.importDesktopDataIntoSqlite, migration.importWebviewMemoriesIntoSqlite,
        () => migration.importKvConversationsIntoSqlite('{}'), () => hydrateInterimProjections({ read: () => { throw Error("must not read"); }, clear: key => cleared.push(key) })]) {
        await expect(action()).rejects.toMatchObject({ code: "backup/busy" });
      }
      expect(calls).toHaveLength(before); expect(cleared).toEqual([]);
    });
  });

  test("failed credential migration retains its source and does not mark completion; retry drains through the flag", async () => {
    legacy.set("read-aware-ai-config", JSON.stringify({ apiKey: "synthetic", model: "model" }));
    legacy.set("read-aware-ai-key", "legacy-copy"); holds.add("secret_set");
    const work = migration.importDesktopDataIntoSqlite().catch(error => error);
    let captured = false; const backup = withDomainBackup(async () => { captured = true; });
    await tick(); expect(captured).toBe(false);
    take("secret_set").reject({ code: "db/locked", message: "synthetic failure" });
    expect(await work).toMatchObject({ code: "db/locked" }); await backup;
    expect(legacy.get("read-aware-ai-key")).toBe("legacy-copy");
    expect(calls.some(call => call.command === "set_kv" && call.args.key === flag)).toBe(false);
    holds.clear(); holds.add(flag);
    const retry = migration.importDesktopDataIntoSqlite(); let retriedCapture = false;
    const capture = withDomainBackup(async () => { retriedCapture = true; });
    await tick(); expect(retriedCapture).toBe(false);
    const completion = take("set_kv"); expect(completion.args.key).toBe(flag);
    completion.resolve(); await retry; await capture;
    expect(legacy.has("read-aware-ai-key")).toBe(false); holds.clear(); legacy.clear();
  });

  test("conversation and indexedDB memory imports hold every accepted row and close their old database", async () => {
    holds.add("ai_chat_replace");
    const work = migration.importKvConversationsIntoSqlite(JSON.stringify({ a: [{ id: "one", content: "first" }], b: [{ id: "two", content: "second" }] }));
    let captured = false; const backup = withDomainBackup(async () => { captured = true; });
    await tick(); take("ai_chat_replace").resolve(); await tick(); expect(captured).toBe(false);
    take("ai_chat_replace").resolve(); await work; await backup; holds.clear();
    await expect(migration.importKvConversationsIntoSqlite("bad JSON")).rejects.toThrow("not valid JSON");
    memoryRows = [{ id: "memory" }]; holds.add("memory_put");
    const imported = migration.importWebviewMemoriesIntoSqlite().catch(error => error);
    let memoryCaptured = false; const capture = withDomainBackup(async () => { memoryCaptured = true; });
    await tick(); expect(memoryCaptured).toBe(false);
    take("memory_put").reject({ code: "db/locked" });
    expect(await imported).toMatchObject({ code: "db/locked" }); await capture;
    expect(closedDatabases).toBe(1); holds.clear(); memoryRows = undefined;
  });

  test("interim migrations retain failed legacy data and drain accepted rows before capture", async () => {
    const values: Record<string, string> = {
      "read-aware-vocabulary": JSON.stringify([{ id: "word", term: "term", language: "en", addedAt: 0 }]),
      "read-aware-reading-stats": JSON.stringify({ b: { bookId: "b", totalMs: 5, daily: {}, byHour: [] } }),
    };
    const cleared: string[] = []; holds.add("plugin_docs_put"); holds.add("reading_time_import");
    const work = hydrateInterimProjections({ read: key => values[key] ?? null, clear: key => cleared.push(key) });
    let captured = false; const backup = withDomainBackup(async () => { captured = true; });
    await tick(); expect(captured).toBe(false); take("plugin_docs_put").resolve();
    await tick(); expect(captured).toBe(false); take("reading_time_import").reject({ code: "db/locked" });
    await work; await backup;
    expect(cleared).toEqual(["read-aware-vocabulary"]); holds.clear(); expect(durableWrites.size).toBe(0);
  });

  test("local wipe and anti-reimport flags drain together; transport preparation may itself await backup", async () => {
    let prepared = 0;
    const transport = spyOn(sync, "syncRelayClient").mockReturnValue({ logout: async () => {
      await withDomainBackup(async () => { prepared++; });
    } } as ReturnType<typeof sync.syncRelayClient>);
    holds.add("wipe_all_data"); holds.add("set_kv");
    try {
      const work = deleteAllData(); await tick(); expect(prepared).toBe(1);
      let captured = false; const backup = withDomainBackup(async () => { captured = true; });
      await tick(); expect(captured).toBe(false); take("wipe_all_data").resolve();
      await tick(); expect(captured).toBe(false); take("set_kv").resolve();
      await tick(); expect(captured).toBe(false); take("set_kv").resolve();
      await work; await backup; expect(legacyClears).toBe(1); holds.clear();
      await withDomainBackup(async () => {
        const before = calls.length;
        await expect(deleteAllData()).rejects.toMatchObject({ code: "backup/busy" });
        expect(calls).toHaveLength(before); expect(legacyClears).toBe(1);
      });
    } finally { transport.mockRestore(); }
  });
} else {
  test("isolated boot migration and maintenance write admission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_MIGRATIONS_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("5 pass");
  }, 30_000);
}
