import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";

const scenario = process.env.DATA_WIPE_BOOT_CASE;
if (scenario) {
  test(`wipe recovery before hydration: ${scenario}`, async () => {
    const ipc = await import("./ipc"), environment = await import("./environment");
    const legacy = await import("./desktop-import"), interim = await import("./interim-projections");
    const secrets = await import("./secret-store"), genesis = await import("./event-genesis");
    const profile = await import("../domain/user-profile"), webview = await import("./clear-webview-storage");
    const order: string[] = []; let loads = 0, imports = 0;
    const flags = { "read-aware-migrated-v1": "1", "read-aware-migrated-memories-v1": "1" };
    const mocks = [
      spyOn(environment, "isTauri").mockReturnValue(true),
      spyOn(ipc, "invoke").mockImplementation(async <T>(command: string): Promise<T> => {
        order.push(command);
        if (command === "load_kv_all") {
          if (scenario === "snapshot-fails") throw new AppError("db/locked", "native snapshot unavailable");
          return (loads++ === 0 ? { ...flags, [scenario === "webview-only" ? "read-aware-wipe-webview-pending" : "read-aware-wipe-pending"]: "1" } : flags) as T;
        }
        if (command === "delete_kv") return undefined as T;
        expect(command).toBe("wipe_all_data");
        if (scenario === "cleanup-fails") throw new AppError("data/wipe-incomplete", "file access still denied");
        return undefined as T;
      }),
      spyOn(legacy, "importDesktopDataIntoSqlite").mockImplementation(async () => { imports++; }),
      spyOn(legacy, "importWebviewMemoriesIntoSqlite").mockImplementation(async () => { imports++; }),
      spyOn(webview, "clearWebviewStorage").mockImplementation(async () => { order.push("clear-webview"); }),
      spyOn(interim, "hydrateInterimProjections").mockImplementation(async () => { order.push("interim"); }),
      spyOn(secrets, "hydrateSecrets").mockImplementation(async () => { order.push("secrets"); }),
      spyOn(profile, "initializeUserProfile").mockImplementation(async () => { order.push("profile"); }),
      spyOn(genesis, "reconcileGenesisEvents").mockImplementation(async () => { order.push("genesis"); }),
    ];
    try {
      const { hydrateLocalStore } = await import("./local-store");
      if (scenario === "recovered" || scenario === "webview-only") {
        await hydrateLocalStore();
        expect(order).toEqual(["load_kv_all", ...(scenario === "recovered" ? ["wipe_all_data"] : []), "clear-webview", "delete_kv", "load_kv_all", "interim", "secrets", "profile", "genesis"]);
      } else {
        await expect(hydrateLocalStore()).rejects.toMatchObject({ code: scenario === "cleanup-fails" ? "data/wipe-incomplete" : "db/locked" });
        expect(order).toEqual(scenario === "cleanup-fails" ? ["load_kv_all", "wipe_all_data"] : ["load_kv_all"]);
      }
      expect(imports).toBe(0);
    } finally { for (const mock of mocks) mock.mockRestore(); }
  });
} else {
  for (const name of ["recovered", "webview-only", "cleanup-fails", "snapshot-fails"]) test(`isolated wipe boot ${name}`, async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, DATA_WIPE_BOOT_CASE: name }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text(); expect(await child.exited, output).toBe(0);
  }, 30_000);
}
