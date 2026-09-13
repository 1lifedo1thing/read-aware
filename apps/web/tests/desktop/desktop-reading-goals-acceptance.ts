import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { installedPluginsAtom, pluginToolsAtom } from "../../src/features/plugins/state/plugin-store";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";
import { localKV } from "../../src/platform/local-store";
import { getSecret, setSecretAsync, deleteSecretAsync } from "../../src/platform/secret-store";
import { AI_CONFIG_KEY, encodeAIConfig } from "../../src/features/ai/lib/ai-config";
import { createSettingsDomain } from "../../src/domain/settings/domain";
import { createReadingDomain } from "../../src/domain/reading";
import { getSyncProfile } from "../../src/platform/sync/sync-store";
import { listLibraryBooks } from "../../src/features/library/lib/library-db";
import { clearConversation, loadConversation, saveConversation } from "../../src/features/ai/lib/conversation-store";
import { discardAgentThread } from "../../src/features/ai/agent/agent-runtime";

const ids = ["376345a4-903a-4dc2-b357-0c94ff13879a", "577b9004-6eba-4dbc-98c6-09e50a31a2ef"];
let backup: { config: string | null; key: string; enabled: boolean; memory: boolean; histories: Awaited<ReturnType<typeof loadConversation>>[] } | null = null;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.sync-acceptance-20260913")) throw Error("Requires owned synthetic profile");
  if ((await getSyncProfile()).syncEnabled) throw Error("Keep sync disabled");
  const books = await listLibraryBooks();
  if (books.length !== 3 || books.some(b => !/^Synthetic sync [AB] 20260913(?: restart)?$/.test(b.title))) throw Error("Unexpected data in synthetic profile");
}
const tool = (name: string) => {
  const t = getDefaultStore().get(pluginToolsAtom).find(t => t.pluginId === "reading-goals" && t.name === name);
  if (!t) throw Error(`Compiled Reading Goals tool unavailable: ${name}`);
  return t;
};

export async function prepareReadingGoalsAcceptance() {
  await isolated();
  if (backup) throw Error("Already prepared");
  const p = getDefaultStore().get(installedPluginsAtom).find(p => p.manifest.id === "reading-goals");
  if (!p?.builtin) throw Error("Expected compiled first-party plugin");
  const settings = createSettingsDomain("user");
  backup = { config: localKV.getItem(AI_CONFIG_KEY), key: getSecret("ai-api-key.custom"), enabled: p.enabled,
    memory: (await settings.queries.read("ai.preferences.buildMemory")).value === true, histories: await Promise.all(ids.map(id => loadConversation(id))) };
  if (!p.enabled) await setPluginEnabled("reading-goals", true);
  for (const bookId of ids) {
    const state = await tool("get_reading_goal").execute({ bookId }) as { goal: unknown };
    if (state.goal !== null) throw Error("Owned books must start without goals");
    if (backup.histories[ids.indexOf(bookId)]!.length) throw Error("Owned books must start without conversations");
  }
  await settings.commands.update([{ path: "ai.preferences.buildMemory", value: false }]);
  await setSecretAsync("ai-api-key.custom", "synthetic-goals-context-only");
  await localKV.setItemAsync(AI_CONFIG_KEY, encodeAIConfig({ provider: "custom", apiKey: "synthetic-goals-context-only", model: "goals-context-probe", customBaseUrl: "http://127.0.0.1:19849/v1", customApi: "openai-completions", thinkingLevel: "off", customMaxOutputTokens: 512 }));
  return { ids, pluginVersion: p.manifest.version, syncDisabled: true, existingHistories: backup.histories.map(h=>h.length) };
}

/** Fixture setup uses the compiled Worker callbacks; ChatPanel sends all tested turns. */
export async function writeAcceptanceGoal(index: number, text: string) {
  await isolated();
  if (!backup || !ids[index] || !/^GOAL_88_[AB]/.test(text)) throw Error("Invalid owned goal");
  const bookId = ids[index]!;
  const state = await tool("get_reading_goal").execute({ bookId }) as { revision: string | null };
  const receipt = await tool("set_reading_goal").execute({ bookId, text, suggestMemory: false, expectedRevision: state.revision });
  return { receipt, state: await tool("get_reading_goal").execute({ bookId }) };
}

export async function openAcceptanceGoalBook(index: number) {
  await isolated();
  if (!backup || !ids[index]) throw Error("Invalid owned book");
  return createReadingDomain("user").commands.openBook(ids[index]!);
}
export async function enableAcceptanceGoals(enabled: boolean) {
  await isolated(); if (!backup) throw Error("Not prepared");
  await setPluginEnabled("reading-goals", enabled);
  return { enabled, registeredTools: getDefaultStore().get(pluginToolsAtom).filter(t=>t.pluginId==="reading-goals").length };
}
export async function cleanupReadingGoalsAcceptance() {
  await isolated(); if (!backup) throw Error("Not prepared");
  await setPluginEnabled("reading-goals", true);
  for (const bookId of ids) {
    const state = await tool("get_reading_goal").execute({ bookId }) as { revision: string | null };
    await tool("clear_reading_goal").execute({ bookId, expectedRevision: state.revision });
    await discardAgentThread("book", bookId);
    await clearConversation(bookId);
    if (backup.histories[ids.indexOf(bookId)]!.length) await saveConversation(bookId, backup.histories[ids.indexOf(bookId)]!);
  }
  if (backup.config === null) await localKV.removeItemAsync(AI_CONFIG_KEY); else await localKV.setItemAsync(AI_CONFIG_KEY, backup.config);
  if (backup.key) await setSecretAsync("ai-api-key.custom", backup.key); else await deleteSecretAsync("ai-api-key.custom");
  await createSettingsDomain("user").commands.update([{ path: "ai.preferences.buildMemory", value: backup.memory }]);
  await setPluginEnabled("reading-goals", backup.enabled);
  const restored = localKV.getItem(AI_CONFIG_KEY) === backup.config && getSecret("ai-api-key.custom") === backup.key;
  backup = null;
  return { restored, goalsCleared: true, historiesRestored: true, syncDisabled: !(await getSyncProfile()).syncEnabled };
}
