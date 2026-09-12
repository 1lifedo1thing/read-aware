import { AppError } from "@read-aware/core";
import type { PluginStorage } from "@read-aware/plugin-types";
import type { PluginDocumentMutation, PluginDocumentPageFilter } from "./plugin-backend";
import { createPluginDocuments, type PluginDocumentsBackend } from "./plugin-documents";
import type { PluginRestoreStorage } from "./plugin-worker-host";

/** The native token fixes the owner and private SQLite connection. */
export type BackupProgramStageQuery =
  | { kind: "get" | "remove"; key: string }
  | { kind: "set"; key: string; json: string }
  | { kind: "docsGet" | "docsDelete"; collection: string; id: string }
  | { kind: "docsPut"; collection: string; id: string; json: string; bookId?: string; anchor?: string }
  | { kind: "docsList"; collection: string; bookId?: string; limit?: number; oldestFirst?: boolean }
  | { kind: "docsPage"; collection: string; query: PluginDocumentPageFilter }
  | { kind: "docsApply"; changes: PluginDocumentMutation[] }
  | { kind: "snapshot"; schemaVersion: number };
export type BackupProgramStageReceipt = { token: string; storage: Record<string, string> };
export type BackupProgramStageCall = <T>(query: BackupProgramStageQuery) => Promise<T>;

export function createBackupProgramStorage(pluginId: string, initial: Record<string, string>, call: BackupProgramStageCall): PluginRestoreStorage {
  const mirror = new Map(Object.entries(initial));
  const parse = <T>(raw: string | null | undefined): T | null => {
    if (raw == null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  };
  const writable = (key: string) => {
    if (typeof key !== "string" || key === "schedule-state" || key === "schedule-runs") {
      throw new AppError("plugin/invalid-input", "Schedule receipts are host-owned");
    }
  };
  const backend: PluginDocumentsBackend = {
    pluginDocsGet: (_owner, collection, id) => call({ kind: "docsGet", collection, id }),
    pluginDocsPut: (_owner, collection, id, json, options) => call({ kind: "docsPut", collection, id, json, ...options }),
    pluginDocsDelete: (_owner, collection, id) => call({ kind: "docsDelete", collection, id }),
    pluginDocsList: (_owner, collection, filter) => call({ kind: "docsList", collection, ...filter }),
    pluginDocsPage: (_owner, collection, query) => call({ kind: "docsPage", collection, query }),
    pluginDocsApply: (_owner, changes) => call({ kind: "docsApply", changes }),
  };
  return {
    snapshot: () => Object.fromEntries(mirror),
    create(lifecycle): PluginStorage {
      return {
        policy: async () => { throw new AppError("plugin/not-supported", "Live storage policy is unavailable in backup migration"); },
        get: key => parse(mirror.get(key)),
        getDurable: key => lifecycle.read("services.storage.getDurable", async () => parse(await call<string | null>({ kind: "get", key }))),
        set(key, value) {
          writable(key);
          return lifecycle.storageWrite("services.storage.set", async () => {
            const json = JSON.stringify(value ?? null);
            await call({ kind: "set", key, json });
            mirror.set(key, json);
          });
        },
        remove(key) {
          writable(key);
          return lifecycle.storageWrite("services.storage.remove", async () => {
            await call({ kind: "remove", key });
            mirror.delete(key);
          });
        },
        flush: () => lifecycle.drainStorageWrites(),
        // Staged contributions never become active. Keep registration lifecycle
        // semantics without subscribing this private namespace to live writes.
        onChange: () => lifecycle.stage(() => ({ dispose() {} })),
        ...createPluginDocuments(pluginId, lifecycle, backend),
      };
    },
  };
}
