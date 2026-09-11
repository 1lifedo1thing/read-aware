import { AppError } from "@read-aware/core";

/** Host-only admission for writers outside a plugin runtime. The runtime's own
 * storage is controlled by quiesce/migration; it must not join this barrier. */
type State = { revision: object; writers: Set<Promise<void>>; update?: PluginDataUpdate };
export type PluginDataUpdate = { readonly pluginId: string; readonly done: Promise<void> };
const states = new Map<string, State>();
function state(id: string): State {
  let value = states.get(id);
  if (!value) { value = { revision: {}, writers: new Set() }; states.set(id, value); }
  return value;
}

export function pluginDataRevision(id: string): object { return state(id).revision; }

export async function withPluginDataWrites<T>(ids: readonly string[], operation: () => T | Promise<T>, expected?: ReadonlyMap<string, object>): Promise<T> {
  const owners = [...new Set(ids)].map(id => [id, state(id)] as const);
  // Admit the entire settings batch synchronously, before any read or side effect.
  for (const [id, owner] of owners) {
    if (owner.update) throw new AppError("plugin/data-busy", "Plugin data is being updated");
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
  if (owner.update) throw new AppError("plugin/data-busy", "Plugin data is already being updated");
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
