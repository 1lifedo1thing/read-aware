import { expect, spyOn, test } from "bun:test";

if (process.env.BACKUP_DOMAIN_PROOF === "1") {
  type Pending = { command: string; args: any; resolve(value?: unknown): void; reject(error: unknown): void };
  const pending: Pending[] = [], calls: string[] = [];
  const holds = new Set<string>();
  const credentialObligations = new Set<string>();
  let summary: string | null = "before";
  const revision = `profile2:${"a".repeat(64)}`;
  const native = async (command: string, args: any): Promise<unknown> => {
    calls.push(command);
    if (holds.has(command)) return new Promise((resolve, reject) => pending.push({ command, args, resolve: value => {
      if (command === "secret_set" && args?.roam !== false && typeof args?.key === "string" && args.key.startsWith("ai-api-key")) credentialObligations.add(args.key);
      if (command === "restored_credentials_publish") {
        for (const event of args?.events ?? []) {
          const key = event?.payload?.key;
          if (typeof key === "string" && key.startsWith("secret:")) credentialObligations.delete(key.slice("secret:".length));
        }
      }
      resolve(value);
    }, reject }));
    if (command === "local_device_get") return { deviceId: "domain-proof", lastHlcWallMs: null, lastHlcCounter: null };
    if (command === "profile_initialize") return { migrated: false, snapshot: { summary, revision } };
    if (command === "profile_inspect") return { summary, revision };
    if (command === "profile_restore") { summary = args.event.payload.summary; return { changed: true, revision, persistence: "event-log" }; }
    if (command === "commit_events") return { appended: args.events.length, applied: args.events.length };
    if (command === "restored_credentials_pending") return [...credentialObligations];
    if (["secret_keys", "reading_sessions_pending"].includes(command)) return [];
    if (command === "backup_close_reading_sessions") return [];
    return undefined;
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: { invoke: native } } });
  const { withDomainBackup } = await import("./domain-write-gate");
  const events = await import("./domain-events");
  const kv = await import("./local-store");
  const secrets = await import("./secret-store");
  await import("./roaming-preferences");
  const profile = await import("../domain/user-profile");
  const { decideEntity } = await import("../domain/entity-registry");
  const { mutateMemory } = await import("../domain/memory-management");
  const { changeBookClassification } = await import("../domain/book-classification");
  const { saveBookDigest } = await import("../domain/book-digest");
  const { commitAnnotationMutations } = await import("../features/annotations/lib/annotation-mutations");
  const { exportBackup, importBackup } = await import("../features/settings/lib/backup-io");
  const library = await import("../features/library/lib/library-db");
  const annotations = await import("../features/annotations/lib/annotation-db");
  const { durableWrites } = await import("./write-settlement");
  const { onAppEvent } = await import("./app-events");
  const tick = () => Bun.sleep(0);
  const take = (command: string) => {
    const index = pending.findIndex(item => item.command === command);
    expect(index).toBeGreaterThanOrEqual(0); return pending.splice(index, 1)[0]!;
  };

  test("domain backup drains actual KV/secret publication tails and delayed envelope preparation", async () => {
    await secrets.hydrateSecrets();
    await secrets.setSecretAsync("sync.master-key", btoa(String.fromCharCode(...new Uint8Array(32).fill(17))));
    holds.add("set_kv"); holds.add("secret_set"); holds.add("local_device_get"); holds.add("commit_events"); holds.add("restored_credentials_publish");
    const setting = kv.localKV.setItemAsync("read-aware-app-settings", '{"theme":"dark"}');
    const secret = secrets.setSecretAsync("ai-api-key.proof", "synthetic");
    expect(kv.localKV.getItem("read-aware-app-settings")).toBe('{"theme":"dark"}');
    expect(secrets.getSecret("ai-api-key.proof")).toBe("synthetic");
    let captured = false;
    const backup = withDomainBackup(async () => { captured = true; });
    await tick(); take("set_kv").resolve(); take("secret_set").resolve();
    await Promise.all([setting, secret]); await tick(); expect(captured).toBe(false);
    const deviceReads = [take("local_device_get"), take("local_device_get")];
    for (const read of deviceReads) read.resolve({ deviceId: "domain-proof", lastHlcWallMs: null, lastHlcCounter: null });
    await tick(); expect(captured).toBe(false);
    const commits = [take("commit_events")];
    expect(JSON.stringify(commits.map(item => item.args))).not.toContain("synthetic");
    for (const commit of commits) commit.resolve({ appended: 1, applied: 1 });
    await tick(); expect(captured).toBe(false);
    const publication = take("restored_credentials_publish");
    expect(JSON.stringify(publication.args)).not.toContain("synthetic");
    publication.resolve({ events: publication.args.events, awaitingConnection: false });
    await backup; expect(captured).toBe(true); expect(durableWrites.size).toBe(0); holds.clear();
  });

  test("an accepted conditional transaction keeps its cancelled owner's real receipt and observer tail", async () => {
    const controller = new AbortController();
    holds.add("entity_commit"); holds.add("commit_events");
    let tail: Promise<unknown> | undefined;
    const stop = events.onDomainEventBroadcast(event => {
      if (event.type === "entity.resolved") tail = events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true } });
    });
    const write = decideEntity({ op: "resolve", entityId: "e", kind: "person", canonicalName: "Name", expectedRevision: `entities1:${"a".repeat(64)}` }, "plugin:writer", controller.signal);
    await tick(); const nativeWrite = take("entity_commit");
    let captured = false;
    const backup = withDomainBackup(async () => { captured = true; });
    controller.abort(); await tick(); expect(captured).toBe(false);
    nativeWrite.resolve({ changed: true, revision: "next", persistence: "event-log" });
    expect(await write).toMatchObject({ changed: true }); await tick(); expect(captured).toBe(false);
    take("commit_events").resolve({ appended: 1, applied: 1 });
    await tail; await backup; expect(captured).toBe(true); stop(); holds.clear();
  });

  test("actual export rejects every event actor and conditional domain writes before mint or IPC", async () => {
    const captured = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const mocks = [spyOn(kv, "dumpLocalKV").mockImplementation(async () => { captured.resolve(); await release.promise; return {}; }),
      spyOn(library, "listLibraryBooks").mockResolvedValue([]), spyOn(library, "listCollections").mockResolvedValue([]),
      spyOn(annotations, "listAnnotations").mockResolvedValue([])];
    const failures: unknown[] = [], off = onAppEvent("local-write-failed", value => failures.push(value));
    let settingMirror = kv.localKV.getItem("read-aware-app-settings");
    const stopMirror = kv.onLocalKVChange((key, value) => { if (key === "read-aware-app-settings") settingMirror = value; });
    const backup = exportBackup();
    try {
      await captured.promise; await tick();
      const before = calls.length;
      for (const origin of ["user", "agent", "plugin:writer"] as const) {
        await expect(events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true }, origin })).rejects.toMatchObject({ code: "backup/busy" });
      }
      await expect(events.appendDomainEvents([{ type: "book.starred", payload: { bookId: "b", starred: true } }])).rejects.toMatchObject({ code: "backup/busy" });
      const candidates = [
        () => decideEntity({ op: "resolve", entityId: "e", kind: "person", canonicalName: "Name", expectedRevision: `entities1:${"a".repeat(64)}` }, "plugin:writer"),
        () => mutateMemory({ op: "forget", memoryId: "m", expectedRevision: `mem1:${"a".repeat(64)}` }, "agent"),
        () => changeBookClassification({ bookId: "b", narrativity: "expository", expectedRevision: `bcl1:${"a".repeat(64)}` }, "user"),
        () => saveBookDigest("b", { chapterIndex: 0, summary: "Summary", characters: [], relations: [], digestVersion: 1 }, `bdg1:${"a".repeat(64)}`),
        () => commitAnnotationMutations([{ op: "updateNote", annotationId: "n", body: "new", expectedRevision: `ann1:${"a".repeat(64)}` }], "plugin:writer"),
        () => profile.restoreUserProfile("unauthorized", revision),
        () => kv.localKV.setItemAsync("read-aware-app-settings", "denied"),
        () => secrets.setSecretAsync("ai-api-key.proof", "denied"),
        () => secrets.setPluginSecret("writer", "token", "denied"),
      ];
      for (const candidate of candidates) await expect(candidate()).rejects.toMatchObject({ code: "backup/busy" });
      kv.localKV.setItem("read-aware-app-settings", "optimistic candidate");
      settingMirror = "optimistic candidate";
      await tick();
      expect(settingMirror).toBe('{"theme":"dark"}');
      expect(calls).toHaveLength(before);
      expect(kv.localKV.getItem("read-aware-app-settings")).toBe('{"theme":"dark"}');
      expect(secrets.getSecret("ai-api-key.proof")).toBe("synthetic");
      expect(failures).toEqual([expect.objectContaining({ kind: "kv", code: "backup/busy" }), expect.objectContaining({ kind: "secret", code: "backup/busy" }), expect.objectContaining({ kind: "kv", code: "backup/busy" })]);
      release.resolve(); expect(JSON.parse(await backup).kv[profile.LEGACY_PROFILE_KEY]).toBe("before");
      await events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true } });
    } finally { release.resolve(); await backup.catch(() => {}); off(); stopMirror(); for (const mock of mocks) mock.mockRestore(); }
  });

  test("v1 restores through scoped KV/profile authority and cancellation retains a dispatched restore", async () => {
    holds.add("profile_restore");
    const controller = new AbortController();
    const backup = importBackup(JSON.stringify({ kind: "backup", books: [], kv: { [profile.LEGACY_PROFILE_KEY]: "restored", "read-aware-theme": "paper" } }), controller.signal);
    let finished = false; void backup.then(() => { finished = true; });
    await tick(); const restore = take("profile_restore");
    controller.abort(); await tick(); expect(finished).toBe(false);
    await expect(kv.localKV.setItemAsync("later", "denied")).rejects.toMatchObject({ code: "backup/busy" });
    expect(restore.args.event.payload.summary).toBe("restored"); expect(restore.args.expectedRevision).toBe(revision);
    restore.resolve({ changed: true, revision: "next", persistence: "event-log" });
    expect(await backup).toMatchObject({ settings: 2 }); holds.clear();
    await kv.localKV.setItemAsync("later", "accepted"); expect(kv.localKV.getItem("later")).toBe("accepted");
  });
} else {
  test("isolated production domain backup admission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_DOMAIN_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("4 pass");
  }, 30_000);
}
