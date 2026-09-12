import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createLibraryDomain } from "../../src/domain/library";
import { invoke } from "../../src/platform/ipc";
import { localKV } from "../../src/platform/local-store";
import { appHttpFetch } from "../../src/platform/http-client";
import { getSecret, setSecretAsync } from "../../src/platform/secret-store";
import { AI_CONFIG_KEY, encodeAIConfig, getAIConfig } from "../../src/features/ai/lib/ai-config";
import { modelCatalog } from "../../src/features/ai/lib/model-catalog";
import { getAgentRuntime, discardAgentThread } from "../../src/features/ai/agent/agent-runtime";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { clearConversation, loadConversation } from "../../src/features/ai/lib/conversation-store";
import { installedPluginsAtom, pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";

const backupKey = "capability-real-image-probe.backup";
let modelId = "openai/gpt-4.1-mini";
type Backup = { config: string | null; key: string; bookId?: string; textDeskEnabled: boolean };
let backup: Backup | undefined;
let controller: AbortController | undefined;

async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) {
    throw Error("Requires isolated capability-e2e profile");
  }
}
async function saveBackup() {
  await invoke("secret_set", { key: backupKey, value: JSON.stringify(backup) });
}

/** The one-use loopback endpoint supplies an authorized key without putting it in tool output. */
export async function prepareRealImageProbe(keyEndpoint: string, visionModel = "openai/gpt-4.1-mini") {
  await isolated();
  if (backup || await invoke("secret_get", { key: backupKey })) throw Error("Clean previous image probe first");
  const url = new URL(keyEndpoint);
  if (url.origin !== "http://127.0.0.1:19847") throw Error("Requires the one-use local credential endpoint");
  const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === "text-desk");
  if (!plugin?.builtin) throw Error("Requires compiled first-party Text Desk");
  backup = { config: localKV.getItem(AI_CONFIG_KEY), key: getSecret("ai-api-key.openrouter"), textDeskEnabled: plugin.enabled };
  await saveBackup();
  try {
    const response = await appHttpFetch(url.href, { method: "POST" });
    if (!response.ok) throw Error("Credential handoff unavailable");
    const key = await response.text();
    if (!key.trim()) throw Error("Empty credential handoff");
    await setSecretAsync("ai-api-key.openrouter", key, "remote");
    await modelCatalog.refresh("openrouter");
    const model = modelCatalog.getModels("openrouter").find(item => item.id === visionModel);
    if (!model?.input.includes("image")) throw Error("Current catalog does not offer the vision model");
    modelId = visionModel;
    await localKV.setItemAsync(AI_CONFIG_KEY, encodeAIConfig({ provider: "openrouter", apiKey: key, model: modelId,
      fastModel: modelId, thinkingLevel: "off", fastThinkingLevel: "off" }));
    if (!plugin.enabled) await setPluginEnabled("text-desk", true);

    const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 240;
    const painter = canvas.getContext("2d")!;
    painter.fillStyle = "#ffffff"; painter.fillRect(0, 0, 360, 240);
    painter.fillStyle = "#173c88"; painter.beginPath(); painter.moveTo(65, 35); painter.lineTo(15, 135);
    painter.lineTo(115, 135); painter.closePath(); painter.fill();
    painter.fillStyle = "#ffd229"; painter.beginPath(); painter.arc(290, 85, 50, 0, Math.PI * 2); painter.fill();
    painter.fillStyle = "#bc278e"; painter.fillRect(145, 160, 70, 60);
    const png = canvas.toDataURL("image/png").split(",")[1];
    const marker = crypto.randomUUID();
    // Neither metadata, alt text nor prose describes the pixels.
    const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>Image Input Probe ${marker}</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware Tests</nickname></author><date>2026-09-13</date><id>${marker}</id><version>1</version></document-info></description><body><section><title><p>Illustration</p></title><p>This section contains a test illustration.</p><image l:href="#picture"/></section></body><binary id="picture" content-type="image/png">${png}</binary></FictionBook>`;
    const book = await createLibraryDomain("user").commands.books.importBook({ fileName: "image-input.fb2", data: new TextEncoder().encode(source) });
    backup.bookId = book.id; await saveBackup();
    await buildRuntimeDeps().reader.openBook(book.id);
    return { bookId: book.id, model: modelId, input: model.input, textDeskVersion: plugin.manifest.version,
      expected: "white background; dark blue triangle upper left; yellow circle upper right; magenta rectangle lower center", width: 360, height: 240 };
  } catch (error) { await cleanupRealImageProbe(); throw error; }
}

export async function realImageAgentTurn(text = "请实际查看本书的插图，用三条短句描述图形的颜色、形状和相对位置。不要根据书名或周围文字猜测。") {
  await isolated();
  if (!backup?.bookId || getAIConfig()?.model !== modelId) throw Error("Prepare image probe first");
  const runtime = getAgentRuntime(); if (!runtime) throw Error("Product runtime unavailable");
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 120_000);
  let answer = "";
  const tools: { tool: string; phase: string; args?: unknown; isError?: boolean; output?: string }[] = [];
  const inputs = new Map<string, unknown>();
  const started = Date.now();
  try {
    for await (const chunk of runtime.sendTurn({ kind: "book", bookId: backup.bookId }, { text, signal: controller.signal })) {
      if (chunk.type === "text") answer += chunk.text;
      if (chunk.type === "tool-step" && chunk.phase === "start") inputs.set(chunk.id, chunk.args);
      if (chunk.type === "tool-step" && chunk.phase === "end") tools.push({ tool: chunk.tool, phase: chunk.phase,
        args: inputs.get(chunk.id), isError: chunk.isError, output: chunk.output?.slice(0, 500) });
    }
    const conversation = await loadConversation(backup.bookId);
    return { answer, tools, elapsedMs: Date.now() - started,
      // Product chat hooks own persistence; this direct runtime probe does not exercise them.
      persistedMessageCount: conversation.length,
      persistedContainsImageBytes: /data:image|iVBORw0KGgo/.test(JSON.stringify(conversation)) };
  } catch (error) {
    return { failed: true, answer, tools, elapsedMs: Date.now() - started,
      code: error && typeof error === "object" && "code" in error ? error.code : null,
      aborted: controller.signal.aborted };
  } finally { clearTimeout(timeout); controller = undefined; }
}

export async function openRealImageTextDesk() {
  await isolated(); if (!backup?.bookId) throw Error("Prepare image probe first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "text-desk" && item.id === "open");
  if (!command) throw Error("Text Desk command unavailable");
  await runPluginContribution("text-desk", "text-desk", () => command.run(), { presentation: "dialog", owner: command.run });
}

export async function cleanupRealImageProbe() {
  await isolated(); controller?.abort();
  const saved = await invoke<string | null>("secret_get", { key: backupKey });
  if (saved) backup = JSON.parse(saved) as Backup;
  if (!backup) return { cleaned: true };
  if (backup.bookId) {
    const book = await createLibraryDomain("user").queries.books.get(backup.bookId);
    if (book && !book.title.startsWith("Image Input Probe ")) throw Error("Owned image book identity mismatch");
    await discardAgentThread("book", backup.bookId);
    await clearConversation(backup.bookId);
    await buildRuntimeDeps().reader.close();
    if (book) await createLibraryDomain("user").commands.books.remove(backup.bookId);
  }
  await setPluginEnabled("text-desk", false);
  if (backup.config === null) await localKV.removeItemAsync(AI_CONFIG_KEY);
  else await localKV.setItemAsync(AI_CONFIG_KEY, backup.config);
  await setSecretAsync("ai-api-key.openrouter", backup.key, "remote");
  if (backup.textDeskEnabled) await setPluginEnabled("text-desk", true);
  const configRestored = localKV.getItem(AI_CONFIG_KEY) === backup.config;
  const keyRestored = getSecret("ai-api-key.openrouter") === backup.key;
  await invoke("secret_delete", { key: backupKey }); backup = undefined;
  return { cleaned: true, configRestored, keyRestored };
}
