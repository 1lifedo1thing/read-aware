import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginBookAccess, PluginDisposable } from "@read-aware/plugin-types";
import { localKV } from "../../src/platform/local-store";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { createReadingDomain } from "../../src/domain/reading";

/** Open a caller-prepared fixture through the actual isolated reader. */
export async function openFull2AccessFixture(bookId: string) {
  const dataDir = (await appDataDir()).replace(/[/\\]$/, "");
  if (!dataDir.endsWith("/com.readaware.app.validation-full2-e2e")) throw new Error("Requires isolated full2 validation profile");
  return createReadingDomain("user").commands.openBook(bookId, AbortSignal.timeout(20_000));
}

/** Uses caller-prepared fixtures only in the owned full-validation profile. */
export async function runDesktopBookAccessProbe(grant: PluginBookAccess, allowed: string, other: string) {
  const dataDir = (await appDataDir()).replace(/[/\\]$/, "");
  if (!dataDir.endsWith("/com.readaware.app.validation-full2-e2e")) throw new Error("Requires isolated full2 validation profile");
  if (!allowed || !other || allowed === other) throw new Error("Two distinct fixture books are required");
  const id = `book-access-proof-${crypto.randomUUID()}`;
  const key = `read-aware-plugin.${id}.input`;
  const disposables: PluginDisposable[] = [];
  await localKV.setItemAsync(key, JSON.stringify({ allowed, other }));
  let worker: Awaited<ReturnType<typeof startPluginWorker>> | undefined;
  try {
    worker = await startPluginWorker({
      id, name: "Book access proof", version: "1.0.0", schemaVersion: 1,
      permissions: ["library:read", "annotations:read"],
      requires: { services: { storage: "^2.0.0" } },
    }, "0.5.4", disposables, { bookAccess: grant, moduleUrl: new URL("./book-access-probe.ts", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === "verify");
    if (!command) throw new Error("Real Worker command did not register");
    const result = await command.run();
    if (typeof result?.toast !== "string") throw new Error("Worker produced no verification receipt");
    return JSON.parse(result.toast) as unknown;
  } finally {
    try { await worker?.terminate(); }
    finally {
      for (const disposable of disposables.reverse()) disposable.dispose();
      await localKV.removeItemAsync(key);
    }
    if (inspectContributions(id).length) throw new Error("Book access proof leaked contributions");
  }
}
