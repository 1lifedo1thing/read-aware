import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { invoke } from "../../src/platform/ipc";
import { getPluginBookAccess, forgetPluginBookAccess, installedPluginsAtom, pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { updatePluginBookAccess, setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";

/** Exercises the installed compiled consumer and actual durable grant writes. */
export async function runFull2GrantRestartProbe(bookId: string) {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.validation-full2-e2e")) throw new Error("Requires Full2 isolation");
  const id = "annotations";
  const store = getDefaultStore();
  const plugin = store.get(installedPluginsAtom).find(item => item.manifest.id === id);
  if (!plugin?.enabled || !plugin.builtin) throw new Error("Requires enabled bundled Annotations");
  const prior = getPluginBookAccess(id);
  const command = () => store.get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === "open");
  const old = command();
  if (!old) throw new Error("Consumer command missing");
  try {
    await updatePluginBookAccess(id, { mode: "book", bookId });
    let oldCode: string | undefined;
    try { await old.run(); } catch (error) { oldCode = (error as { code?: string }).code; }
    if (oldCode !== "plugin/unavailable") throw new Error(`Expected retired Worker rejection, received: ${oldCode}`);
    const disk = await invoke<Record<string, string>>("load_kv_all");
    const saved = JSON.parse(disk["read-aware-plugins-book-access"]!)[id];
    if (saved?.mode !== "book" || saved.bookId !== bookId) throw new Error("Grant was not persisted");
    await setPluginEnabled(id, false);
    await setPluginEnabled(id, true);
    const current = command();
    if (!current || current.run === old.run) throw new Error("Worker did not restart");
    const result = await current.run();
    if (!result?.view) throw new Error("Restarted consumer returned no view");
    return { oldCode, saved, reloaded: getPluginBookAccess(id), consumerView: result.view.kind };
  } finally {
    await updatePluginBookAccess(id, prior.grant);
    if (prior.source === "legacy-domain") {
      await setPluginEnabled(id, false);
      await forgetPluginBookAccess(id);
      await setPluginEnabled(id, true);
    }
  }
}
