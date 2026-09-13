import { appDataDir } from "@tauri-apps/api/path";
import type { Id } from "@read-aware/core";
import { createLibraryDomain } from "../../src/domain/library";
import { createReadingDomain } from "../../src/domain/reading";
import { localKV } from "../../src/platform/local-store";
import { AI_CONFIG_KEY, encodeAIConfig, getAIConfig } from "../../src/features/ai/lib/ai-config";
import { getSecret, setSecretAsync, deleteSecretAsync } from "../../src/platform/secret-store";
import { invoke } from "../../src/platform/ipc";
import { createSettingsDomain } from "../../src/domain/settings/domain";
import { getAgentRuntime, discardAgentThread } from "../../src/features/ai/agent/agent-runtime";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { clearConversation, loadConversation, saveConversation } from "../../src/features/ai/lib/conversation-store";
import { buildConversationTools } from "../../../../packages/agent/src/tools/conversation-tools";
import { buildReaderTools } from "../../../../packages/agent/src/tools/reader-tools";

const bookKey = "capability-reading-context-probe.book";
const selection = "SELECTION_MARKER_947";
const responsesBackupKey = "capability-responses-probe.backup";
type ResponsesBackup = { config: string | null; customKey: string; buildMemory: boolean };

export async function prepareResponsesConfig() {
  await assertIsolated();
  if (await invoke("secret_get", { key: responsesBackupKey })) throw Error("Restore previous Responses probe first");
  const settings = createSettingsDomain("user");
  const backup: ResponsesBackup = { config: localKV.getItem(AI_CONFIG_KEY), customKey: getSecret("ai-api-key.custom"), buildMemory: (await settings.queries.read("ai.preferences.buildMemory")).value as boolean };
  await invoke("secret_set", { key: responsesBackupKey, value: JSON.stringify(backup) });
  await settings.commands.update([{ path: "ai.preferences.buildMemory", value: false }]);
  await setSecretAsync("ai-api-key.custom", "controlled-responses-probe");
  await localKV.setItemAsync(AI_CONFIG_KEY, encodeAIConfig({ provider: "custom", apiKey: "controlled-responses-probe", model: "privacy-probe", thinkingLevel: "medium", customBaseUrl: "http://127.0.0.1:19843/v1", customApi: "openai-responses", customSupportsThinking: true, customMaxOutputTokens: 2048 }));
  return { configured: true, api: getAIConfig()?.customApi };
}

export async function restoreResponsesConfig() {
  await assertIsolated();
  const raw = await invoke<string | null>("secret_get", { key: responsesBackupKey });
  if (!raw) throw Error("Responses backup missing");
  const backup = JSON.parse(raw) as ResponsesBackup;
  if (backup.config === null) await localKV.removeItemAsync(AI_CONFIG_KEY);
  else await localKV.setItemAsync(AI_CONFIG_KEY, backup.config);
  if (backup.customKey) await setSecretAsync("ai-api-key.custom", backup.customKey);
  else await deleteSecretAsync("ai-api-key.custom");
  await createSettingsDomain("user").commands.update([{ path: "ai.preferences.buildMemory", value: backup.buildMemory }]);
  const restored = localKV.getItem(AI_CONFIG_KEY) === backup.config && getSecret("ai-api-key.custom") === backup.customKey;
  if (!restored) throw Error("Responses configuration restore mismatch");
  await invoke("secret_delete", { key: responsesBackupKey });
  return { configRestored: true, credentialRestored: true, buildMemoryRestored: (await createSettingsDomain("user").queries.read("ai.preferences.buildMemory")).value === backup.buildMemory };
}
async function assertIsolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
}
function bookId(): Id {
  const id = localKV.getItem(bookKey);
  if (!id) throw new Error("Reading context probe book unavailable");
  return id as Id;
}
export async function prepareReadingContextProbe() {
  await assertIsolated();
  if (localKV.getItem(bookKey)) throw new Error("Clean up previous reading context probe first");
  const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>ReadAware Tests</nickname></author><book-title>Reading Context Policy Probe</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-09</date><id>context-policy-${crypto.randomUUID()}</id><version>1</version></document-info></description><body><section id="one"><title><p>Privacy sample</p></title><p>BEFORE_MARKER_512. ${selection}. VIEWPORT_MARKER_628. This is synthetic test text, not a user book.</p></section></body></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: "reading-context-probe.fb2", data: new TextEncoder().encode(source) });
  await localKV.setItemAsync(bookKey, book.id);
  await createReadingDomain("agent").commands.openBook(book.id);
  return { bookId: book.id };
}
export async function readingContextProbeTurn(text = "Explain the selected passage", withSelection = true) {
  await assertIsolated();
  const config = getAIConfig();
  if (config?.provider !== "custom" || config.customBaseUrl !== "http://127.0.0.1:19843/v1" || config.model !== "privacy-probe") {
    throw new Error("Configure the controlled loopback inference probe first");
  }
  const runtime = getAgentRuntime();
  if (!runtime) throw new Error("Controlled runtime unavailable");
  const deps = buildRuntimeDeps();
  const snapshot = await deps.reader.getSession();
  if (snapshot.bookId !== bookId() || snapshot.status !== "ready" || !snapshot.visibleText.includes(selection)) {
    throw new Error("The synthetic book must be rendered in the reader");
  }
  const toc = await deps.bookText.getToc(bookId());
  const chapter = toc.find(entry => entry.hrefs?.length);
  if (!chapter) throw new Error("Synthetic book TOC is unavailable");
  const chapterHref = chapter.hrefs![0];
  try {
    for await (const _ of runtime.sendTurn({ kind: "book", bookId: bookId() }, {
      text, attachments: withSelection ? [{ text: selection, chapter: chapterHref, anchor: snapshot.location?.cfi }] : undefined,
      readingCursor: { chapter: chapterHref, chapterIndex: chapter.index, visibleText: snapshot.visibleText, anchor: snapshot.location?.cfi },
    })) { /* Drain the product runtime; request bytes are captured by the loopback server. */ }
    await runtime.flushBackgroundWork();
    return { status: "completed", visible: true };
  } catch (error) {
    return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null };
  }
}
export async function seedReadingContextHistory() {
  await assertIsolated();
  await saveConversation(bookId(), [
    { id: crypto.randomUUID(), role: "user", content: "Prior typed question", createdAt: new Date().toISOString(),
      attachments: [{ kind: "selection", text: selection, cfiRange: null, chapterHref: null }] },
    { id: crypto.randomUUID(), role: "assistant", content: "Prior controlled answer", createdAt: new Date().toISOString() },
  ]);
  return readingContextHistorySnapshot();
}
export async function readingContextHistorySnapshot() {
  await assertIsolated();
  const deps = buildRuntimeDeps();
  const scope = { kind: "book", bookId: bookId() } as const;
  const tools = [...buildConversationTools(scope, deps), ...buildReaderTools(scope, deps)];
  const run = (name: string, args = {}) => tools.find(tool => tool.name === name)!.execute("context-probe", args);
  return {
    localSelected: JSON.stringify(await loadConversation(bookId())).includes(selection),
    recentSelected: JSON.stringify(await run("get_recent_turns")).includes(selection),
    searchSelected: JSON.stringify(await run("search_conversation", { queries: [selection] })).includes(selection),
    sessionSelected: JSON.stringify(await run("get_reading_session")).includes(selection),
  };
}
export async function cleanupReadingContextProbe() {
  await assertIsolated();
  const id = localKV.getItem(bookKey);
  if (id) {
    const library = createLibraryDomain("user");
    const book = await library.queries.books.get(id);
    if (book && book.title !== "Reading Context Policy Probe") throw new Error("Probe book identity mismatch");
    await createReadingDomain("user").commands.close();
    await discardAgentThread("book", id);
    await clearConversation(id);
    if (book) await library.commands.books.remove(id);
    await localKV.removeItemAsync(bookKey);
  }
  return { cleaned: true };
}
