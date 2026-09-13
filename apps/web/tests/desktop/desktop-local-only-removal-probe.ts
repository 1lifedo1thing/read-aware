import { appDataDir } from "@tauri-apps/api/path";
import { localKV, flushLocalKV } from "../../src/platform/local-store";
import { invoke } from "../../src/platform/ipc";
import { createSettingsDomain } from "../../src/domain/settings/domain";
import { AI_PREFERENCES_KEY, DEFAULT_AI_PREFERENCES, getAIPreferences, saveAIPreferences } from "../../src/features/settings/lib/ai-preferences";

/** Keep imports in one Vite graph so HMR does not create a second KV mirror. */
export async function runLocalOnlyRemovalProbe() {
  const profile = await appDataDir();
  if (!profile.replace(/[/\\]$/, "").endsWith("/com.readaware.app.validation-full2-e2e")) throw new Error("Requires Full2 isolation");
  const before = localKV.getItem(AI_PREFERENCES_KEY);
  try {
    await localKV.setItemAsync(AI_PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_AI_PREFERENCES,
      localOnly: true, sendHighlightedText: false, sendSurroundingContext: true, buildMemory: false }));
    const loaded = getAIPreferences();
    if ("localOnly" in loaded || loaded.sendHighlightedText !== false || loaded.sendSurroundingContext !== true || loaded.buildMemory !== false) {
      throw new Error("Legacy preference normalization failed");
    }
    saveAIPreferences(loaded);
    await flushLocalKV(AI_PREFERENCES_KEY);
    const disk = await invoke<Record<string, string>>("load_kv_all");
    if ("localOnly" in JSON.parse(disk[AI_PREFERENCES_KEY]!)) throw new Error("Retired value persisted");
    const settings = createSettingsDomain("user");
    const catalog = await settings.queries.snapshot();
    if (catalog.settings.some(item => item.path === "ai.preferences.localOnly")) throw new Error("Retired catalog entry remains");
    let rejected = false;
    try { await settings.queries.read("ai.preferences.localOnly"); } catch { rejected = true; }
    if (!rejected) throw new Error("Retired setting remained readable");
    return { profile, legacyIgnored: true, savedValueClean: true, independentPreferencesRetained: true, catalogAbsent: true, oldPathRejected: true };
  } finally {
    if (before === null) await localKV.removeItemAsync(AI_PREFERENCES_KEY);
    else await localKV.setItemAsync(AI_PREFERENCES_KEY, before);
  }
}
