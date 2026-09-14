import { AppError, domainGrantsFromPermissions, type ChangesQuery } from "@read-aware/core";
import type { PluginManifest } from "@read-aware/plugin-types";
import { createChangesPort } from "../../../domain/changes";
import type { PluginBookAccessFence, PluginBookAccessPolicy } from "../../../domain/plugin-object-access";
import type { SettingsDomain } from "../../../domain/settings/domain";
import { settingsChangeKeys } from "../../../domain/settings/persistence";
import { actorCause, type DomainActor } from "../../../platform/domain-actor";
import type { PluginLifecycleController } from "./plugin-lifecycle";

export function createPluginChanges(manifest: PluginManifest, access: PluginBookAccessPolicy,
  lifecycle: PluginLifecycleController, actor: DomainActor, settings: SettingsDomain) {
  const grants = domainGrantsFromPermissions(manifest.permissions ?? []);
  const authorize = (query: ChangesQuery) => {
    lifecycle.assertActive("services.changes"); lifecycle.signal.throwIfAborted(); actorCause(actor);
    if (access.restricted && !query.bookId) throw new AppError("plugin/object-access-denied", "Change queries require the granted book");
    if (query.bookId) access.assertBook(query.bookId, "changes");
    for (const area of query.areas) {
      if (area !== "documents" && area !== "settings" && !grants[area]) throw new AppError("plugin/permission-denied", "Change area is not granted");
    }
  };
  return createChangesPort({ owner: `plugin:${manifest.id}`, pluginId: manifest.id,
    acquire: async (query, signal) => {
      let fence: PluginBookAccessFence | undefined;
      try {
        authorize(query); signal?.throwIfAborted();
        if (query.bookId) fence = await access.beginBook(query.bookId, "changes");
        const settingsKeys = await settingsChangeKeys(settings, query.settingsPaths ?? [], query.bookId);
        return { settingsKeys,
          assert: async () => { authorize(query); signal?.throwIfAborted(); await fence?.assertUnchanged({ retain: true });
            // Enabled plugin settings and target-specific catalog leaves can change
            // while the cursor write waits for the domain queue.
            await settingsChangeKeys(settings, query.settingsPaths ?? [], query.bookId);
            authorize(query); signal?.throwIfAborted(); await fence?.assertUnchanged({ retain: true }); },
          dispose: () => fence?.dispose() };
      } catch (error) { fence?.dispose(); throw error; }
    },
  });
}
