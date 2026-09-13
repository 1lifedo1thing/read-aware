import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { testLlmConnection, type AgentRuntime } from "@read-aware/agent";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { localKV } from "../../src/platform/local-store";
import { invoke } from "../../src/platform/ipc";
import { flushSecretWrites, getSecret, hydrateSecrets } from "../../src/platform/secret-store";
import { AI_CONFIG_KEY, DEFAULT_MODELS, encodeAIConfig } from "../../src/features/ai/lib/ai-config";
import { getAgentRuntime, discardAgentThread } from "../../src/features/ai/agent/agent-runtime";
import { appHttpFetch } from "../../src/platform/http-client";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";

const id = "capability-inference-probe";
const prefix = `read-aware-plugin.${id}.`;
const backupKey = `${id}.backup`;
const disposables: PluginDisposable[] = [];
let worker: Awaited<ReturnType<typeof startPluginWorker>> | undefined;
let original: { config: string | null; key: string; credentials?: Record<string, string> } | undefined;
let runtime: AgentRuntime | undefined;
const account = { kind: "api-key", provider: "custom-openai", apiKey: "privacy-probe-only", baseUrl: "http://127.0.0.1:19843/v1", api: "openai-completions" } as const;

async function assertIsolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Inference probes require isolated capability-e2e data");
}

export async function prepareInferenceProbe(snapshotAllCredentials = false) {
  await assertIsolated();
  if (original || await invoke("secret_get", { key: backupKey })) throw new Error("Clean up the previous inference probe before preparing another");
  await flushSecretWrites();
  original = { config: localKV.getItem(AI_CONFIG_KEY), key: getSecret("ai-api-key.custom") };
  // The real Clear configuration UI removes every provider slot. Preserve all
  // of them inside the native encrypted backup before exercising that action.
  if (snapshotAllCredentials) {
    const slots = ["ai-api-key", ...Object.keys(DEFAULT_MODELS).map(provider => `ai-api-key.${provider}`)];
    original.credentials = Object.fromEntries(await Promise.all(slots.map(async key => [key, await invoke<string | null>("secret_get", { key }) ?? ""])));
  }
  // Keep recovery outside the WebView lifetime, including dev-server reloads.
  await invoke("secret_set", { key: backupKey, value: JSON.stringify(original) });
  await invoke("secret_set", { key: "ai-api-key.custom", value: account.apiKey });
  await hydrateSecrets();
  await localKV.setItemAsync(AI_CONFIG_KEY, encodeAIConfig({ provider: "custom", apiKey: account.apiKey, model: "privacy-probe", thinkingLevel: "off", fastThinkingLevel: "off", customBaseUrl: account.baseUrl, customApi: account.api }));
  runtime = getAgentRuntime()!;
  const manifest: PluginManifest = {
    id, name: "Inference policy probe", version: "1.0.0", schemaVersion: 1, description: "Isolated inference policy validation",
    permissions: ["service:llm"], requires: { services: { llm: "^1.0.0", storage: "^2.0.0" } },
  };
  worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./inference-probe.ts", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  return { ready: !!runtime };
}

export async function pluginInference(mode: string) {
  await assertIsolated();
  await localKV.setItemAsync(prefix + "mode", JSON.stringify(mode));
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "ask");
  if (!command) throw new Error("Inference probe command unavailable");
  await command.run();
  return JSON.parse(localKV.getItem(prefix + "result") ?? "null");
}

export async function agentInference(mode: "ask" | "turn" | "connection" | "HOLD") {
  await assertIsolated();
  if (!runtime) throw new Error("Inference probe unavailable");
  try {
    if (mode === "turn") {
      const chunks = [];
      for await (const chunk of runtime.sendTurn({ kind: "global", threadId: id }, { text: "privacy probe turn" })) chunks.push(chunk.type);
      return { status: "completed", chunks };
    }
    const text = mode === "connection"
      ? await testLlmConnection(account, "privacy-probe", { fetch: appHttpFetch })
      : await runtime.ask({ prompt: `privacy probe ${mode}` });
    return { status: "completed", text };
  } catch (error) {
    return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null };
  }
}

export async function cleanupInferenceProbe() {
  await assertIsolated();
  await flushSecretWrites();
  const backup = await invoke<string | null>("secret_get", { key: backupKey });
  if (backup) original = JSON.parse(backup);
  await worker?.terminate(); worker = undefined;
  for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
  await discardAgentThread("global", id);
  if (original) {
    if (original.config === null) await localKV.removeItemAsync(AI_CONFIG_KEY);
    else await localKV.setItemAsync(AI_CONFIG_KEY, original.config);
    if (original.key) await invoke("secret_set", { key: "ai-api-key.custom", value: original.key });
    else await invoke("secret_delete", { key: "ai-api-key.custom" });
    // hydrateSecrets does not clear deleted slots; discard the diagnostic slot in its mirror too.
    const { deleteSecret } = await import("../../src/platform/secret-store");
    if (!original.key) deleteSecret("ai-api-key.custom");
    if (original.credentials) {
      for (const [key, value] of Object.entries(original.credentials)) {
        if (value) await invoke("secret_set", { key, value });
        else { await invoke("secret_delete", { key }); deleteSecret(key as Parameters<typeof deleteSecret>[0]); }
      }
    }
    await flushSecretWrites();
    await hydrateSecrets();
    await invoke("secret_delete", { key: backupKey });
    original = undefined;
  }
  runtime = undefined;
  for (const key of ["mode", "result"]) await localKV.removeItemAsync(prefix + key);
  return { contributions: inspectContributions(id).length };
}
