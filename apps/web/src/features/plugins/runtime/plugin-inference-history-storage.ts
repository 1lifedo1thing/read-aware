import { withPluginRuntimeDataWrite } from "../../../platform/plugin-data-access";
import { pluginDocsGet, pluginDocsPut } from "./plugin-backend";
import type { InferenceHistoryStorage } from "./plugin-inference-history";

export function inferenceHistoryStorage(pluginId: string): InferenceHistoryStorage {
  return { key: `plugin-inference:${pluginId}`,
    read: async () => (await pluginDocsGet(pluginId, "_host_inference_history", "recent"))?.json ?? null,
    write: value => pluginDocsPut(pluginId, "_host_inference_history", "recent", value), run: withPluginRuntimeDataWrite };
}
