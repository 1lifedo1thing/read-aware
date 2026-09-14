import { AppError, type ChangesQuery } from "@read-aware/core";
import { threadScopeKey, type ThreadScope } from "@read-aware/agent";
import { createChangesPort } from "../../../../domain/changes";
import { createSettingsDomain } from "../../../../domain/settings/domain";
import { settingsChangeKeys } from "../../../../domain/settings/persistence";

export function agentChanges(scope: ThreadScope) {
  const settings = createSettingsDomain("agent");
  const authorize = (query: ChangesQuery) => {
    if (query.areas.includes("documents")) throw new AppError("plugin/permission-denied", "Agent change queries do not own plugin documents");
    if (scope.kind === "book" && query.bookId !== scope.bookId) throw new AppError("plugin/object-access-denied", "Change query is outside the conversation book");
  };
  return createChangesPort({ owner: `agent:${threadScopeKey(scope)}`,
    acquire: async (query, signal) => {
      authorize(query); signal?.throwIfAborted();
      const settingsKeys = await settingsChangeKeys(settings, query.settingsPaths ?? [], query.bookId);
      return { settingsKeys, assert: async () => { authorize(query); signal?.throwIfAborted();
        await settingsChangeKeys(settings, query.settingsPaths ?? [], query.bookId); signal?.throwIfAborted(); }, dispose() {} };
    },
  });
}
