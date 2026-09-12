import { expect, test } from "bun:test";

if (process.env.PERSISTENCE_SHUTDOWN_PROOF === "1") {
  type Pending = { command: string; args: Record<string, unknown>; resolve(value?: unknown): void; reject(error: unknown): void };
  const pending: Pending[] = [];
  let hold = false;
  const device = { deviceId: "shutdown-proof", lastHlcWallMs: null, lastHlcCounter: null };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke(command: string, args: Record<string, unknown>) {
      if (command === "secret_keys") return Promise.resolve([]);
      if (["secret_set", "secret_delete", "set_kv", "local_device_get", "commit_events"].includes(command) && hold) {
        return new Promise((resolve, reject) => pending.push({ command, args, resolve, reject }));
      }
      if (command === "local_device_get") return Promise.resolve(device);
      return Promise.resolve();
    },
  } } });
  const { ShutdownCoordinator } = await import("../services/shutdown");
  const { registerPersistenceShutdownOwners } = await import("./persistence-shutdown");
  const secrets = await import("./secret-store");
  const { localKV } = await import("./local-store");
  await import("./roaming-preferences");
  const { onDomainEventBroadcast, commitDomainEvents } = await import("./domain-events");
  const { durableWrites } = await import("./write-settlement");
  const { toBase64, openSecret } = await import("./sync-envelope");
  const tick = () => Bun.sleep(0);
  const take = (command: string) => {
    const index = pending.findIndex(work => work.command === command);
    expect(index).toBeGreaterThanOrEqual(0);
    return pending.splice(index, 1)[0]!;
  };

  test("actual KV/credential observers and delayed identity, IPC and post-commit work drain before shutdown", async () => {
    await secrets.hydrateSecrets();
    const key = new Uint8Array(32).fill(17);
    await secrets.setSecretAsync("sync.master-key", toBase64(key));
    const coordinator = new ShutdownCoordinator(() => {});
    const dispose = registerPersistenceShutdownOwners(coordinator);
    const observed: string[] = [];
    const stop = onDomainEventBroadcast(event => {
      if (event.type !== "preference.changed") return;
      observed.push(event.payload.key);
      if (event.payload.key === "secret:ai-api-key.proof") {
        void commitDomainEvents({ type: "preference.changed", payload: { key: "observer-followup", value: true } });
      }
    });
    hold = true;
    const saved = secrets.setSecretAsync("ai-api-key.proof", "synthetic-proof");
    const setting = localKV.setItemAsync("read-aware-app-settings", '{"theme":"dark"}');
    let closed = false;
    const closing = coordinator.prepare().then(receipt => { closed = true; return receipt; });
    await tick(); expect(closed).toBe(false);
    take("secret_set").resolve(); take("set_kv").resolve();
    await Promise.all([saved, setting]); await tick();
    expect(closed).toBe(false); expect(durableWrites.size).toBe(2);
    expect(pending.map(work => work.command)).toEqual(["local_device_get"]);
    take("local_device_get").resolve(device); await tick();
    expect(observed).toEqual([]); expect(closed).toBe(false);
    const commits = [take("commit_events"), take("commit_events")];
    const drafts = commits.flatMap(work => work.args.events as { payload: { key: string; value: { sealed: string } } }[]);
    const sealed = drafts.find(draft => draft.payload.key === "secret:ai-api-key.proof")!;
    expect(openSecret(key, "ai-api-key.proof", sealed.payload.value.sealed)).toBe("synthetic-proof");
    expect(JSON.stringify(drafts)).not.toContain("synthetic-proof");
    for (const commit of commits) commit.resolve({ appended: 1, applied: 1 });
    await tick(); expect(closed).toBe(false);
    expect(observed).toContain("secret:ai-api-key.proof");
    take("commit_events").resolve({ appended: 1, applied: 1 });
    const receipt = await closing;
    expect(receipt.status).toBe("ready");
    expect(receipt.owners.slice(0, 2).map(owner => [owner.name, owner.phase]).sort()).toEqual([
      ["credentials", "persist"], ["local-kv", "persist"],
    ]);
    expect(receipt.owners.at(-1)).toMatchObject({ name: "domain-events", phase: "receipts" });
    expect(observed).toContain("observer-followup");
    expect(durableWrites.size).toBe(0); expect(pending).toHaveLength(0);
    stop(); dispose(); hold = false;
  });

  test("failed secret persistence degrades the receipt while successful KV publication still drains", async () => {
    const coordinator = new ShutdownCoordinator(() => {}), dispose = registerPersistenceShutdownOwners(coordinator);
    hold = true;
    const failed = secrets.setSecretAsync("ai-api-key.failed", "synthetic-failure").catch(error => error);
    const saved = localKV.setItemAsync("read-aware-app-settings", '{"theme":"light"}');
    let closed = false;
    const closing = coordinator.prepare().then(receipt => { closed = true; return receipt; });
    await tick(); take("secret_set").reject({ code: "db/locked" }); take("set_kv").resolve();
    expect((await failed).code).toBe("db/locked"); await saved; await tick();
    expect(closed).toBe(false); expect(secrets.getSecret("ai-api-key.failed")).toBe("");
    take("commit_events").resolve({ appended: 1, applied: 1 });
    const receipt = await closing;
    expect(receipt.status).toBe("degraded");
    expect(receipt.owners.find(owner => owner.name === "credentials")).toMatchObject({ status: "failed", code: "db/locked" });
    expect(receipt.owners.find(owner => owner.name === "domain-events")?.status).toBe("flushed");
    expect(pending).toHaveLength(0); expect(durableWrites.size).toBe(0);
    dispose(); hold = false;
  });
} else {
  test("isolated production persistence shutdown chain", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PERSISTENCE_SHUTDOWN_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("2 pass");
  }, 30_000);
}
