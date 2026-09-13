import { actorOrigin, type DomainActor } from "../../../platform/domain-actor";
import { localKV, afterLocalKVWrites } from "../../../platform/local-store";
import { runDomainWrite } from "../../../platform/domain-write-gate";
import { durableWrites } from "../../../platform/write-settlement";
import { withPluginRuntimeDataWrite } from "../../../platform/plugin-data-access";
import { pluginDocsGet, pluginDocsPut } from "../../plugins/runtime/plugin-backend";
import { BookTextTaskHistory, type TextHistoryStorage } from "./book-text-task-history";

/** Hidden host collection joins plugin snapshot/rollback/full backup/uninstall.
 * Host Agent/user ledgers remain local KV metadata; no business-event replay. */
export function createTextTaskHistory(origin: DomainActor, trackCleanup?: (work: Promise<void>) => void): BookTextTaskHistory {
  const pluginId = actorOrigin(origin).startsWith("plugin:") ? actorOrigin(origin).slice(7) : null;
  const key = `read-aware-text-task-history:${actorOrigin(origin)}`;
  const storage: TextHistoryStorage = pluginId ? {
    read: async () => (await pluginDocsGet(pluginId, "_host_text_history", "recent"))?.json ?? null,
    write: value => pluginDocsPut(pluginId, "_host_text_history", "recent", value),
    run: withPluginRuntimeDataWrite,
  } : {
    read: () => afterLocalKVWrites(() => localKV.getItem(key)),
    write: value => localKV.setItemAsync(key, value),
    run: runDomainWrite,
  };
  return new BookTextTaskHistory(key, storage, work => { durableWrites.track(work); trackCleanup?.(work); });
}
