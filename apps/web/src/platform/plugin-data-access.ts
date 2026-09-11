import { AppError } from "@read-aware/core";
import { PluginPreferencePublication } from "./plugin-preference-publication";

/** Host-only admission for writers outside a plugin runtime. The runtime's own
 * storage is controlled by quiesce/migration; it must not join this barrier. */
type State = { revision: object; writers: Set<Promise<void>>; update?: PluginDataUpdate };
export type PluginDataUpdate = { readonly pluginId: string; readonly done: Promise<void> };
const states = new Map<string, State>();
let backup: { done: Promise<void> } | undefined;
function state(id: string): State {
  let value = states.get(id);
  if (!value) { value = { revision: {}, writers: new Set() }; states.set(id, value); }
  return value;
}

export function pluginDataRevision(id: string): object { return state(id).revision; }

export async function withPluginDataWrites<T>(ids: readonly string[], operation: () => T | Promise<T>, expected?: ReadonlyMap<string, object>): Promise<T> {
  const owners = [...new Set(ids)].map(id => [id, state(id)] as const);
  if (backup && owners.length) throw new AppError("plugin/data-busy", "Plugin data is participating in a backup operation");
  // Admit the entire settings batch synchronously, before any read or side effect.
  for (const [id, owner] of owners) {
    if (owner.update) throw new AppError("plugin/data-busy", "Plugin data is being updated");
    PluginPreferencePublication.assertWritable(id);
    if (expected?.has(id) && expected.get(id) !== owner.revision) {
      throw new AppError("plugin/settings-stale", "Reopen plugin settings after an update");
    }
  }
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  for (const [, owner] of owners) owner.writers.add(done);
  try { return await operation(); }
  finally {
    for (const [, owner] of owners) owner.writers.delete(done);
    finish();
  }
}

/** Roaming retries from a fresh projection after this barrier, not a saved row. */
export async function waitForPluginDataUpdates(ids: readonly string[]): Promise<void> {
  while (true) {
    const pending = [...new Set(ids)].flatMap(id => state(id).update?.done ?? []);
    if (backup && ids.length) pending.push(backup.done);
    if (!pending.length) return;
    await Promise.all(pending);
  }
}

export async function withPluginDataUpdate<T>(id: string, operation: (scope: PluginDataUpdate) => Promise<T>, existing?: PluginDataUpdate): Promise<T> {
  const owner = state(id);
  if (existing) {
    if (existing.pluginId !== id || owner.update !== existing) throw new AppError("plugin/data-busy", "Plugin update scope is no longer current");
    return operation(existing);
  }
  if (backup) throw new AppError("plugin/data-busy", "Plugin data is participating in a backup operation");
  if (owner.update) throw new AppError("plugin/data-busy", "Plugin data is already being updated");
  PluginPreferencePublication.assertAvailable(id);
  let finish!: () => void;
  const scope = { pluginId: id, done: new Promise<void>(resolve => { finish = resolve; }) };
  owner.update = scope;
  owner.revision = {}; // Previously opened forms must not replay a whole old-schema object.
  try {
    await Promise.all([...owner.writers]);
    return await operation(scope);
  } finally {
    owner.update = undefined;
    owner.revision = {}; // Also invalidate forms opened while migration was in progress.
    finish();
  }
}

/** Host-only exclusion between whole-store backup IO and plugin migrations.
 * Reserve synchronously, including owners first encountered after reservation.
 * Busy updates fail before any backup read/write; callers may explicitly retry.
 * This is not a snapshot of ordinary runtime writes or a cross-domain transaction. */
export async function withPluginDataBackup<T>(mode: "export" | "import", operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (backup || [...states.values()].some(owner => owner.update)) {
    throw new AppError("plugin/data-busy", "Plugin update or backup operation is already active");
  }
  PluginPreferencePublication.assertBackupAvailable();
  let finish!: () => void;
  const scope = { done: new Promise<void>(resolve => { finish = resolve; }) };
  backup = scope;
  if (mode === "import") for (const owner of states.values()) owner.revision = {};
  try {
    // Accepted external settings writes retain their real completion. Closing
    // admission first prevents later settings or roaming batches from racing IO.
    await Promise.all([...new Set([...states.values()].flatMap(owner => [...owner.writers]))]);
    signal?.throwIfAborted();
    PluginPreferencePublication.assertBackupAvailable();
    return await operation();
  } finally {
    if (mode === "import") for (const owner of states.values()) owner.revision = {};
    backup = undefined;
    finish();
  }
}
