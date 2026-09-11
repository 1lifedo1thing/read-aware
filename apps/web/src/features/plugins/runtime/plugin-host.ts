/**
 * The plugin lifecycle owner: enumerate installed folders, start each enabled
 * plugin in its sandbox, and keep the installed-plugins atom truthful.
 * Desktop-only — in a plain browser (dev/Storybook) every function is a no-op.
 * A broken plugin records its error and stays inert; it must never take the app
 * down.
 *
 * Plugin CODE runs in a Worker (plugin-sandbox.worker.ts), not here. This
 * module only decides what may start and holds the handle for tearing it down.
 */
import { getVersion } from "@tauri-apps/api/app";
import { getDefaultStore } from "jotai";
import { withContributionActivation } from "../state/contribution-activation";
import { isTauri } from "../../../platform/environment";
import { withPluginDataUpdate, type PluginDataUpdate } from "../../../platform/plugin-data-access";
import { PluginPreferencePublication } from "../../../platform/plugin-preference-publication";
import { acceptPluginPreferencePublication } from "../../../platform/roaming-preferences";
import { localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { PluginManifestError, parseManifestJson, versionSatisfies } from "../lib/manifest";
import { clearPluginScheduleState } from "./plugin-scheduler";
import type {
  InstalledPlugin,
  PluginDisposable,
  PluginManifest,
} from "../lib/plugin-types";
import {
  forgetPluginEnabled,
  installedPluginsAtom,
  isPluginEnabled,
  markPluginsReady,
  persistPluginEnabled,
  registerFontContribution,
  registerThemeContribution,
  setInstalledPlugins,
  updateInstalledPlugin,
} from "../state/plugin-store";
import { contributionKey } from "../lib/plugin-types";
import { toPluginRef } from "../lib/plugin-theme";
import {
  commitPluginCandidate,
  discardPluginCandidate,
  listPluginEntries,
  pluginCandidateModuleUrl,
  pluginDocsClear,
  stagePluginFiles,
  stagePluginFromDir,
  stagePluginFromZip,
  uninstallPluginFiles,
  type PluginCandidateDiskEntry,
  type PluginFilePayload,
} from "./plugin-backend";
import {
  startPluginWorker,
  type SandboxedPlugin,
  type StartPluginWorkerOptions,
} from "./plugin-worker-host";
import { onAppEvent } from "../../../platform/app-events";
import { unbindVirtualBook } from "../lib/virtual-books";
import { runPluginUpdateTransaction } from "./plugin-update-transaction";
import { assertPluginCapabilityRequirements } from "./plugin-capabilities";
import { planPluginDataMigration } from "./plugin-data-migration";
import { PLUGIN_SCHEMA_KEY_PREFIX, pluginDataSchemaVersion } from "./plugin-data-snapshot";

import { beginPluginUpdate, acceptPluginUpdate, rollbackPluginUpdate, finishPluginUpdate, type PluginUpdateJournal } from "./plugin-update-journal";

const log = createLogger("plugins");

type ActivePlugin = {
  manifest: PluginManifest;
  sandbox: SandboxedPlugin;
  disposables: PluginDisposable[];
  candidateToken?: string;
  promoted: boolean;
};

const active = new Map<string, ActivePlugin>();
let appVersion = "0.0.0";
let initialized = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getInstalled(): InstalledPlugin[] {
  return getDefaultStore().get(installedPluginsAtom);
}

/** Boot entry — enumerate plugin folders and activate the enabled ones. */
export async function initializePlugins(): Promise<void> {
  if (!isTauri()) {
    // No plugin runtime in a plain browser — appearance fallbacks must not
    // keep waiting for contributions that will never register.
    markPluginsReady();
    return;
  }
  if (initialized) return;
  initialized = true;

  try {
    appVersion = await getVersion();
  } catch {
    // Advisory only — minAppVersion checks degrade to permissive.
  }

  let entries;
  try {
    entries = await listPluginEntries();
  } catch (error) {
    log.error("failed to enumerate installed plugins", error);
    // Nothing will register this session; unblock appearance fallbacks.
    markPluginsReady();
    return;
  }

  const installed: InstalledPlugin[] = [];
  for (const entry of entries) {
    try {
      const manifest = parseManifestJson(entry.manifest);
      if (manifest.id !== entry.id) {
        throw new PluginManifestError(
          `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
        );
      }
      installed.push({
        manifest,
        enabled: isPluginEnabled(manifest.id, entry.builtin === true),
        builtin: entry.builtin === true,
      });
    } catch (error) {
      // Keep the broken folder visible in settings instead of hiding it.
      installed.push({
        manifest: {
          id: entry.id,
          name: entry.id,
          version: "0.0.0",
          schemaVersion: 1,
          requires: {},
        },
        enabled: false,
        error: errorMessage(error),
      });
    }
  }
  setInstalledPlugins(installed);

  await Promise.all(
    installed
      .filter((plugin) => plugin.enabled && !plugin.error)
      .map((plugin) => activatePlugin(plugin.manifest)),
  );
  markPluginsReady();

  // Any deletion path (shelf UI included) must release the virtual-book
  // binding, or the registry leaks dead entries.
  onAppEvent("book-removed", ({ bookId }) => unbindVirtualBook(bookId));

  // Fallback teardown for an uncoordinated exit — disposables run synchronously;
  // async deactivate() work races the process. The coordinated path is shutdownPlugins().
  window.addEventListener("pagehide", () => {
    for (const id of [...active.keys()]) void deactivatePlugin(id);
  });
}

/** Coordinated shutdown: quiesce every active plugin so Worker writes reach native storage
 * before the process ends. Failures are logged per plugin and never block the others. */
export async function shutdownPlugins(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const results = await Promise.allSettled([...active.keys()].map(id => deactivatePlugin(id)));
  for (const result of results) if (result.status === "rejected") log.warn("plugin shutdown failed", result.reason);
}

/**
 * Start one plugin inside its sandbox; failures are recorded on its settings
 * entry. The plugin's code never enters this realm — `startPluginWorker` runs
 * it in a Worker and brokers everything through its permission-gated context.
 */
async function activatePlugin(manifest: PluginManifest): Promise<void> {
  if (active.has(manifest.id)) return;
  try {
    active.set(manifest.id, await startPluginInstance(manifest));
    updateInstalledPlugin(manifest.id, { error: undefined });
  } catch (error) {
    log.error(`activation of "${manifest.id}" failed`, error);
    updateInstalledPlugin(manifest.id, { error: errorMessage(error) });
  }
}

function assertManifestCanActivate(manifest: PluginManifest): void {
  if (manifest.minAppVersion && !versionSatisfies(appVersion, manifest.minAppVersion)) {
    throw new Error(`requires app version ${manifest.minAppVersion} or newer`);
  }
  assertPluginCapabilityRequirements(manifest);
  const installed = getInstalled().find((plugin) => plugin.manifest.id === manifest.id);
  if (manifest.permissions?.includes("reader:modes") && !installed?.builtin) {
    throw new Error("reader:modes is currently reserved for built-in plugins");
  }
}

/**
 * Construct one fully healthy runtime instance or leave no registrations
 * behind. This is also the primitive used by the update candidate path.
 */
async function startPluginInstance(
  manifest: PluginManifest,
  options: StartPluginWorkerOptions & { deferPromotion?: boolean } = {},
  candidateToken?: string,
  dataUpdate?: PluginDataUpdate,
): Promise<ActivePlugin> {
  assertManifestCanActivate(manifest);
  PluginPreferencePublication.assertAvailable(manifest.id);
  const disposables: PluginDisposable[] = [];
  let sandbox: SandboxedPlugin | undefined;
  try {
    const { deferPromotion = false, ...workerOptions } = options;
    sandbox = await startPluginWorker(manifest, appVersion, disposables, workerOptions);
    await sandbox.checkHealth();
    const instance = { manifest, sandbox, disposables, candidateToken, promoted: false };
    if (!deferPromotion) await withPluginDataUpdate(manifest.id, async () => {
      const storedSchema = getPluginDataSchemaVersion(manifest.id);
      const journal = storedSchema === manifest.schemaVersion ? undefined : await beginPluginUpdate(manifest.id);
      const publication = journal ? PluginPreferencePublication.begin(manifest.id, journal.baseline.kv) : undefined;
      try {
        await migratePluginInstance(instance, journal ? pluginDataSchemaVersion(journal.baseline.schema) : storedSchema);
        promotePluginInstance(instance);
        if (journal) {
          const accepted = await acceptPluginUpdate(journal);
          publication?.rebase(accepted.accepted!.kv);
        }
        if (publication) await acceptPluginPreferencePublication(publication);
        if (journal) await finishPluginUpdate(journal);
      } catch (error) {
        // A teardown failure must not restore under a possibly live writer.
        try {
          await instance.sandbox.terminate();
          if (journal) await rollbackPluginUpdate(journal);
          publication?.rollback();
        } catch (recoveryError) {
          publication?.quarantine();
          throw recoveryError;
        }
        throw error;
      }
    }, dataUpdate);
    return instance;
  } catch (error) {
    // Quiesce the Worker before closing the scope's write gate: messages
    // already issued by the plugin must reach the host's durable-write drain.
    await sandbox?.terminate().catch((terminateError) => {
      log.error(`activation sandbox rollback for "${manifest.id}" failed`, terminateError);
    });
    for (const disposable of [...disposables].reverse()) {
      try {
        disposable.dispose();
      } catch (disposeError) {
        log.error(`activation rollback for "${manifest.id}" failed`, disposeError);
      }
    }
    throw error;
  }
}

function promotePluginInstance(instance: ActivePlugin): void {
  if (instance.promoted) return;
  withContributionActivation(() => {
    instance.sandbox.promote();
    registerManifestContributions(instance.manifest, instance.disposables);
    instance.promoted = true;
  });
}

/**
 * Register the manifest's declarative contributions (validated by
 * `parseManifestJson`). A theme typography default naming the plugin's own
 * font (`plugin:<fontId>`) is expanded here to the full stored ref, so
 * everything downstream sees one ref shape.
 */
function registerManifestContributions(
  manifest: PluginManifest,
  disposables: PluginDisposable[],
): void {
  for (const font of manifest.fonts ?? []) {
    disposables.push(
      registerFontContribution({
        ...font,
        key: contributionKey(manifest.id, font.id),
        pluginId: manifest.id,
        pluginName: manifest.name,
      }),
    );
  }
  for (const theme of manifest.themes ?? []) {
    const typography = theme.reader?.typography;
    const fontFamily = typography?.fontFamily;
    const expanded =
      fontFamily && /^plugin:[a-z0-9][a-z0-9-]*$/.test(fontFamily)
        ? toPluginRef(manifest.id, fontFamily.slice("plugin:".length))
        : fontFamily;
    disposables.push(
      registerThemeContribution({
        ...theme,
        reader: theme.reader && {
          ...theme.reader,
          typography: typography && { ...typography, fontFamily: expanded },
        },
        key: contributionKey(manifest.id, theme.id),
        pluginId: manifest.id,
        pluginName: manifest.name,
      }),
    );
  }
}

/** Dispose every contribution, then tear the plugin's realm down. */
async function deactivatePlugin(id: string): Promise<void> {
  const entry = active.get(id);
  if (!entry) return;
  active.delete(id);
  await stopPluginInstance(entry);
}

async function stopPluginInstance(entry: ActivePlugin): Promise<void> {
  const id = entry.manifest.id;
  try {
    await entry.sandbox.terminate();
  } finally {
    for (const disposable of [...entry.disposables].reverse()) {
      try {
        disposable.dispose();
      } catch (error) {
        log.error(`dispose from "${id}" failed`, error);
      }
    }
    if (entry.candidateToken) {
      await discardPluginCandidate(entry.candidateToken).catch((error) => {
        log.warn(`candidate cleanup for "${id}" failed`, error);
      });
    }
  }
}

/** Settings toggle — persists, then (de)activates immediately, no restart. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  persistPluginEnabled(id, enabled);
  updateInstalledPlugin(id, { enabled, error: undefined });
  if (enabled) {
    const plugin = getInstalled().find((entry) => entry.manifest.id === id);
    if (plugin) await activatePlugin(plugin.manifest);
  } else {
    await deactivatePlugin(id);
  }
}

function parseCandidate(entry: PluginCandidateDiskEntry): PluginManifest {
  const manifest = parseManifestJson(entry.manifest);
  if (manifest.id !== entry.id) {
    throw new PluginManifestError(
      `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
    );
  }
  return manifest;
}

function getPluginDataSchemaVersion(id: string): number | null {
  return pluginDataSchemaVersion(localKV.getItem(PLUGIN_SCHEMA_KEY_PREFIX + id));
}

async function setPluginDataSchemaVersion(id: string, version: number | null): Promise<void> {
  const key = PLUGIN_SCHEMA_KEY_PREFIX + id;
  if (version == null) await localKV.removeItemAsync(key);
  else await localKV.setItemAsync(key, String(version));
}

async function migratePluginInstance(
  instance: ActivePlugin,
  storedVersion: number | null,
): Promise<void> {
  const target = instance.manifest.schemaVersion;
  const migration = planPluginDataMigration({
    storedVersion,
    targetVersion: target,
    hasMigration: instance.sandbox.hasMigration,
  });
  if (migration) await instance.sandbox.migrate(migration);
  await setPluginDataSchemaVersion(instance.manifest.id, target);
}

async function restartPreviousInstance(previous: ActivePlugin, dataUpdate: PluginDataUpdate): Promise<void> {
  const restored = await startPluginInstance(previous.manifest, {}, undefined, dataUpdate);
  active.set(previous.manifest.id, restored);
}

/**
 * Blue-green install/update: activate and probe the staged candidate while the
 * previous version still owns the durable on-disk slot. Only then commit the
 * candidate, switch runtime ownership, and retire the previous sandbox.
 */
async function applyCandidate(entry: PluginCandidateDiskEntry): Promise<InstalledPlugin> {
  let manifest: PluginManifest;
  try {
    manifest = parseCandidate(entry);
  } catch (error) {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw error;
  }
  const existing = getInstalled().find((plugin) => plugin.manifest.id === manifest.id);

  if (existing?.builtin) {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw new Error(`"${manifest.id}" is a built-in plugin and cannot be replaced`);
  }

  const previous = active.get(manifest.id);
  let journal: PluginUpdateJournal | undefined;
  let recovered = false;
  const recoverJournal = async () => {
    if (journal && !recovered) { await rollbackPluginUpdate(journal); recovered = true; }
    publication?.rollback();
  };
  let publication: PluginPreferencePublication | undefined;
  let accepted = false;
  let candidateRuntimeError: string | undefined;
  let committed: Awaited<ReturnType<typeof commitPluginCandidate>> | undefined;
  let previousQuiesced = false;
  const plugin: InstalledPlugin = { manifest, enabled: true };

  let entered = false;
  await withPluginDataUpdate(manifest.id, async dataUpdate => {
    entered = true;
    await runPluginUpdateTransaction<ActivePlugin>({
      startCandidate: () =>
        startPluginInstance(
          manifest,
          {
            moduleUrl: pluginCandidateModuleUrl(entry.token, manifest.main ?? "main.js"),
            instanceId: `${manifest.id}@candidate:${entry.token}`,
            onRuntimeError: (message) => {
              if (accepted) updateInstalledPlugin(manifest.id, { error: message });
              else candidateRuntimeError = message;
            },
            deferPromotion: true,
          },
          entry.token,
        ),
      verifyCandidate: () => {
        if (candidateRuntimeError) throw new Error(candidateRuntimeError);
      },
      commitFiles: async () => {
        if (!journal) throw new Error("plugin update has no durable baseline");
        committed = await commitPluginCandidate(entry.token, journal.updateId);
      },
      verifyCommit: () => {
        if (!committed) throw new Error("plugin candidate was not committed");
        const committedManifest = parseManifestJson(committed.manifest);
        if (committed.id !== manifest.id || committedManifest.version !== manifest.version) {
          throw new Error("committed plugin candidate does not match the health-checked version");
        }
        if (candidateRuntimeError) throw new Error(candidateRuntimeError);
      },
      quiescePrevious: async () => {
        if (!previous) return;
        previousQuiesced = true;
        if (active.get(manifest.id) === previous) active.delete(manifest.id);
        await stopPluginInstance(previous);
      },
      snapshotData: async () => {
        journal = await beginPluginUpdate(manifest.id, entry.token);
        publication = PluginPreferencePublication.begin(manifest.id, journal.baseline.kv);
      },
      migrateCandidate: (next) => {
        if (!journal) throw new Error("plugin update has no rollback baseline");
        return migratePluginInstance(next, pluginDataSchemaVersion(journal.baseline.schema));
      },
      promoteCandidate: (next) => promotePluginInstance(next),
      accept: async (next) => {
        if (!journal) throw new Error("plugin update has no durable baseline");
        const decision = await acceptPluginUpdate(journal);
        publication?.rebase(decision.accepted!.kv);
        active.set(manifest.id, next);
        setInstalledPlugins([
          ...getInstalled().filter((installed) => installed.manifest.id !== manifest.id),
          plugin,
        ]);
        persistPluginEnabled(manifest.id, true);
        accepted = true;
      },
      retirePrevious: async () => {
        if (previous && !previousQuiesced) await stopPluginInstance(previous);
      },
      cleanupCandidate: async (next) => {
        if (active.get(manifest.id) === next) active.delete(manifest.id);
        if (next) await stopPluginInstance(next);
        else await discardPluginCandidate(entry.token);
      },
      rollbackFiles: recoverJournal,
      restoreData: recoverJournal,
      restartPrevious: async () => {
        // Also release a baseline taken before a failed file switch (no migration).
        await recoverJournal();
        if (previous && previousQuiesced) await restartPreviousInstance(previous, dataUpdate);
      },
    }).catch(error => {
      // Successful restoration/restart already released its scope. A retained
      // scope denotes unsafe recovery; never let catch-up publish that data.
      publication?.quarantine();
      throw error;
    });
    if (publication) await acceptPluginPreferencePublication(publication);
    if (journal) await finishPluginUpdate(journal);
  }).catch(async error => {
    if (!entered) await discardPluginCandidate(entry.token).catch(cleanup => log.warn("Rejected candidate cleanup failed", cleanup));
    throw error;
  });

  return plugin;
}

export type PreparedPluginInstall = {
  manifest: PluginManifest;
  complete(): Promise<InstalledPlugin>;
  discard(): Promise<void>;
};

function preparedCandidate(entry: PluginCandidateDiskEntry): PreparedPluginInstall {
  const manifest = parseCandidate(entry);
  let consumed = false;
  return {
    manifest,
    async complete() {
      if (consumed) throw new Error("plugin candidate has already been consumed");
      consumed = true;
      return applyCandidate(entry);
    },
    async discard() {
      if (consumed) return;
      consumed = true;
      await discardPluginCandidate(entry.token);
    },
  };
}

async function prepareStagedCandidate(
  staged: Promise<PluginCandidateDiskEntry>,
): Promise<PreparedPluginInstall> {
  const entry = await staged;
  try {
    return preparedCandidate(entry);
  } catch (error) {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw error;
  }
}

/** Stage a local folder before the consent gate; it is inert until complete. */
export async function preparePluginInstall(srcDir: string): Promise<PreparedPluginInstall> {
  return prepareStagedCandidate(stagePluginFromDir(srcDir));
}

/** Stage a zip before the consent gate; it is inert until complete. */
export async function preparePluginZipInstall(zipPath: string): Promise<PreparedPluginInstall> {
  return prepareStagedCandidate(stagePluginFromZip(zipPath));
}

/** Install (or replace) from fetched file contents (the marketplace path). */
export async function installPluginFiles(
  id: string,
  files: PluginFilePayload[],
): Promise<InstalledPlugin> {
  return applyCandidate(await stagePluginFiles(id, files));
}

/**
 * Remove the plugin's files. Its KV storage is deliberately kept (settings
 * survive a reinstall); its DOCUMENT collections are wiped — documents'
 * declared lifecycle is the plugin's own.
 */
export async function uninstallPlugin(id: string): Promise<void> {
  const target = getInstalled().find((entry) => entry.manifest.id === id);
  if (target?.builtin) throw new Error(`"${id}" is a built-in plugin`);
  await withPluginDataUpdate(id, async () => {
    await deactivatePlugin(id);
    await clearPluginScheduleState(id);
    await uninstallPluginFiles(id);
    await pluginDocsClear(id).catch((error) => {
      log.error(`document wipe for "${id}" failed`, error);
    });
    forgetPluginEnabled(id);
    setInstalledPlugins(getInstalled().filter((entry) => entry.manifest.id !== id));
  });
}
