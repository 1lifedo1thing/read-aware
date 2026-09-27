import { expect, test } from "bun:test";

if (process.env.PERSISTENCE_SHUTDOWN_PROOF === "1") {
  type Pending = {
    command: string;
    args: Record<string, unknown>;
    resolve(value?: unknown): void;
    reject(error: unknown): void;
  };
  const pending: Pending[] = [];
  const credentialMarkers = new Set<string>();
  let hold = false;
  const device = { deviceId: "shutdown-proof", lastHlcWallMs: null, lastHlcCounter: null };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke(command: string, args: Record<string, unknown>) {
          if (command === "secret_keys") return Promise.resolve([]);
          if (command === "restored_credentials_pending") return Promise.resolve([...credentialMarkers]);
          if (
            [
              "secret_set",
              "secret_delete",
              "set_kv",
              "set_kv_batch",
              "local_device_get",
              "commit_events",
              "restored_credentials_publish",
            ].includes(command) &&
            hold
          ) {
            return new Promise((resolve, reject) => pending.push({ command, args, resolve, reject })).then((value) => {
              if (command === "secret_set" && args.roam && String(args.key).startsWith("ai-api-key"))
                credentialMarkers.add(String(args.key));
              if (command === "restored_credentials_publish") credentialMarkers.clear();
              return value;
            });
          }
          if (command === "local_device_get") return Promise.resolve(device);
          return Promise.resolve();
        },
      },
    },
  });
  const { ShutdownCoordinator } = await import("../services/shutdown");
  const { registerPersistenceShutdownOwners } = await import("./persistence-shutdown");
  const secrets = await import("./secret-store");
  const { localKV } = await import("./local-store");
  await import("./roaming-preferences");
  const { onDomainEventBroadcast, commitDomainEvents } = await import("./domain-events");
  const { durableWrites } = await import("./write-settlement");
  const { toBase64 } = await import("./sync-envelope");
  const tick = () => Bun.sleep(0);
  const take = (command: string) => {
    const index = pending.findIndex((work) => work.command === command);
    expect(index).toBeGreaterThanOrEqual(0);
    return pending.splice(index, 1)[0]!;
  };
  /** Supply held device identities until the awaited native command is dispatched. */
  const settle = async (command: string) => {
    for (let round = 0; round < 10 && !pending.some((work) => work.command === command); round++) {
      const identity = pending.findIndex((work) => work.command === "local_device_get");
      if (identity >= 0) pending.splice(identity, 1)[0]!.resolve(device);
      await tick();
    }
    return take(command);
  };

  test("actual KV/credential observers and delayed identity, IPC and post-commit work drain before shutdown", async () => {
    await secrets.hydrateSecrets();
    const key = new Uint8Array(32).fill(17);
    await secrets.setSecretAsync("sync.master-key", toBase64(key));
    const coordinator = new ShutdownCoordinator(() => {});
    const dispose = registerPersistenceShutdownOwners(coordinator);
    const observed: string[] = [];
    const stop = onDomainEventBroadcast((event) => {
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
    const closing = coordinator.prepare().then((receipt) => {
      closed = true;
      return receipt;
    });
    await tick();
    expect(closed).toBe(false);
    take("secret_set").resolve();
    await saved;
    // The roaming setting and its preference event are one native write.
    const preference = await settle("set_kv_batch");
    expect(preference.args.entries).toEqual([["read-aware-app-settings", '{"theme":"dark"}']]);
    expect((preference.args.events as { payload: unknown }[]).map((event) => event.payload)).toEqual([
      { key: "read-aware-app-settings", value: { theme: "dark" } },
    ]);
    expect(observed).toEqual([]);
    expect(closed).toBe(false);
    preference.resolve();
    await setting;
    await tick();
    expect(observed).toEqual(["read-aware-app-settings"]);
    expect(closed).toBe(false);
    const credential = await settle("restored_credentials_publish");
    const events = credential.args.events as { payload: { key: string; value: unknown } }[];
    expect(events.map((event) => event.payload)).toEqual([{ key: "secret:ai-api-key.proof", value: null }]);
    expect(JSON.stringify([preference.args, credential.args])).not.toContain("synthetic-proof");
    await tick();
    expect(closed).toBe(false);
    expect(observed).not.toContain("secret:ai-api-key.proof");
    // Native code owns sealing and atomic marker retirement. This host check proves
    // shutdown waits for that receipt and the event observer it subsequently starts.
    credential.resolve({ events, awaitingConnection: false });
    await tick();
    expect(closed).toBe(false);
    expect(observed).toContain("secret:ai-api-key.proof");
    take("commit_events").resolve({ appended: 1, applied: 1 });
    const receipt = await closing;
    expect(receipt.status).toBe("ready");
    expect(
      receipt.owners
        .slice(0, 2)
        .map((owner) => [owner.name, owner.phase])
        .sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      ["credentials", "persist"],
      ["local-kv", "persist"],
    ]);
    expect(receipt.owners.at(-1)).toMatchObject({ name: "domain-events", phase: "receipts" });
    expect(observed).toContain("observer-followup");
    expect(durableWrites.size).toBe(0);
    expect(pending).toHaveLength(0);
    stop();
    dispose();
    hold = false;
  });

  test("failed secret persistence degrades the receipt while successful KV publication still drains", async () => {
    const coordinator = new ShutdownCoordinator(() => {}),
      dispose = registerPersistenceShutdownOwners(coordinator);
    hold = true;
    const failed = secrets.setSecretAsync("ai-api-key.failed", "synthetic-failure").catch((error) => error);
    const saved = localKV.setItemAsync("read-aware-app-settings", '{"theme":"light"}');
    let closed = false;
    const closing = coordinator.prepare().then((receipt) => {
      closed = true;
      return receipt;
    });
    await tick();
    take("secret_set").reject({ code: "db/locked" });
    expect((await failed).code).toBe("db/locked");
    expect(secrets.getSecret("ai-api-key.failed")).toBe("");
    await tick();
    expect(closed).toBe(false);
    (await settle("set_kv_batch")).resolve();
    await saved;
    const receipt = await closing;
    expect(receipt.status).toBe("degraded");
    expect(receipt.owners.find((owner) => owner.name === "credentials")).toMatchObject({
      status: "failed",
      code: "db/locked",
    });
    expect(receipt.owners.find((owner) => owner.name === "domain-events")?.status).toBe("flushed");
    expect(pending).toHaveLength(0);
    expect(durableWrites.size).toBe(0);
    dispose();
    hold = false;
  });
} else {
  test("isolated production persistence shutdown chain", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PERSISTENCE_SHUTDOWN_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("2 pass");
  }, 30_000);
}
