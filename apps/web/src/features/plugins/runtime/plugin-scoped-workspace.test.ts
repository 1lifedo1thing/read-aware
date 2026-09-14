import { expect, test } from "bun:test";
import { HOST_COMMAND_IDS, hostCommandParameters, type HostCommandRequest, type WorkspaceTarget } from "@read-aware/core";
import type { PluginBookAccess } from "@read-aware/plugin-types";
import { WorkspaceService, type WorkspaceView } from "../../../services/workspace";
import type { actorHostCommands } from "../../../services/host-command-runtime";
import { createPluginBookAccessPolicy, type CurrentBookSnapshot } from "../../../domain/plugin-object-access";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { scopePluginWorkspace } from "./plugin-scoped-workspace";
import { deferred } from "../../../../tests/helpers/entity-host";

function fixture(grant: PluginBookAccess = { mode: "current" }, write = true) {
  let current: CurrentBookSnapshot = { bookId: "z-owned", sessionId: "a1" };
  const readers = new Set<() => void>(), lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const reader = { current: () => current, observe: (handler: () => void) => { readers.add(handler); return () => { readers.delete(handler); }; } };
  const policy = createPluginBookAccessPolicy(grant, async () => current, handler => reader.observe(() => handler(current)), () => current);
  const host = new WorkspaceService(() => {});
  let view: WorkspaceView = { surface: "shelf", collectionId: "private-collection", settings: { open: false, section: null },
    search: { open: false, query: "private search" }, selection: { active: true,
      bookIds: [...Array.from({ length: 1200 }, (_, i) => `other-${i}`), "z-owned"] } };
  const controls = { prepare: async () => {}, effect: async (_target: WorkspaceTarget) => {} };
  const targets: WorkspaceTarget[] = [], requests: HostCommandRequest[] = [];
  const binding = host.bind({ prepare: () => controls.prepare(), apply: async target => {
    targets.push(target); await controls.effect(target);
    if (target.surface === "settings") view = { ...view, settings: { open: true, section: target.section! }, search: { open: false, query: "" } };
    else if (target.surface === "shelf") view = { ...view, surface: "shelf", collectionId: target.collectionId ?? null,
      settings: { open: false, section: null }, search: { open: false, query: "" }, selection: target.selection ?? { active: false, bookIds: [] } };
  }, requestCommit: token => { binding.publish(view, token); host.acknowledge(targets.at(-1)!.surface, token); } }, view);
  const commands: ReturnType<typeof actorHostCommands> = {
    list: async () => ({ version: 1, workspaceRevision: host.snapshot().revision,
      commands: HOST_COMMAND_IDS.map(id => ({ id, title: id, enabled: true, parameters: hostCommandParameters(id) })) }),
    execute: async input => { const request = input as HostCommandRequest; requests.push(request); return { commandId: request.id, status: "completed", completed: ["workspace"] }; },
    check: async _request => ({ operation: "ui.commands.execute", remoteChecked: false, state: "unknown", conditions: [] }),
    observe: () => () => {},
  };
  const api = scopePluginWorkspace(host, commands, policy, lifecycle, reader, write, true);
  return { api, host, commands, controls, targets, requests, readers,
    publish: () => { binding.publish({ ...view, search: { ...view.search, query: "another private search" } }, 0); },
    switchBook: (bookId: string | null) => { current = { bookId, sessionId: bookId }; for (const handler of [...readers]) handler(); },
    close: async () => { lifecycle.stop(); binding.dispose(); await lifecycle.drainCleanups(); },
  };
}

test("workspace filters before paging and counting, and explicitly withholds collection and search fields", async () => {
  const f = fixture({ mode: "book", bookId: "z-owned" }); f.switchBook("foreign");
  try {
    const state = await f.api.workspace!.snapshot({ limit: 1 });
    expect(f.host.snapshot({ limit: 1 }).selection.total).toBe(1201);
    expect(state.selection).toEqual({ active: true, total: 1, bookIds: ["z-owned"], nextCursor: null });
    expect(state.scope).toEqual({ bookId: "z-owned", withheld: ["collectionId", "search.query"] });
    expect(state.collectionId).toBeNull(); expect(state.search.query).toBe("");
    expect(JSON.stringify(state)).not.toContain("private");
    await expect(f.api.workspace!.snapshot({ selectionAfter: "foreign" })).rejects.toMatchObject({ code: "plugin/object-access-denied" });
  } finally { await f.close(); }
});

test("command discovery uses the same actor revision and rejects collections and foreign book execution", async () => {
  const f = fixture();
  try {
    const state = await f.api.workspace!.snapshot(), commands = await f.api.commands!.list();
    expect(commands.workspaceRevision).toBe(state.revision);
    expect(commands.commands.find(command => command.id === "open-collection")).toMatchObject({ enabled: false, unavailableReason: "object-scope" });
    expect(() => f.api.commands!.execute!({ id: "open-collection", args: { collectionId: "private-collection" } })).toThrow();
    expect((await f.api.checkCommand({ id: "open-book", args: { bookId: "foreign" } })).conditions[0]?.kind).toBe("permission");
    expect(() => f.api.commands!.execute!({ id: "open-book", args: { bookId: "foreign" } })).toThrow();
    await f.api.commands!.execute!({ id: "open-book", args: { bookId: "z-owned" }, expectedWorkspaceRevision: state.revision });
    expect(f.requests).toEqual([{ id: "open-book", args: { bookId: "z-owned" }, expectedWorkspaceRevision: f.host.snapshot().revision }]);
    f.publish();
    await expect(f.api.commands!.execute!({ id: "open-settings", expectedWorkspaceRevision: state.revision })).rejects.toMatchObject({ code: "ui/superseded" });
    expect(f.requests).toHaveLength(1);
  } finally { await f.close(); }
});

test("navigation rejects a foreign selection before effects and projects the actual committed receipt", async () => {
  const f = fixture();
  try {
    expect(() => f.api.workspace!.navigate!({ surface: "shelf", selection: { active: true, bookIds: ["foreign"] } })).toThrow();
    expect(() => f.api.workspace!.navigate!({ surface: "shelf", collectionId: "private-collection" })).toThrow();
    expect(f.targets).toEqual([]);
    const before = await f.api.workspace!.snapshot();
    const receipt = await f.api.workspace!.navigate!({ surface: "settings", section: "general" }, before.revision);
    expect(receipt.status).toBe("completed"); expect(receipt.snapshot.settings).toEqual({ open: true, section: "general" });
    expect(receipt.snapshot.selection.total).toBe(1); expect(receipt.snapshot.selection.bookIds).toEqual(["z-owned"]);
    expect(receipt.snapshot.scope?.bookId).toBe("z-owned");
  } finally { await f.close(); }
});

test("a reader change during navigation preparation cancels before applying UI effects", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  f.controls.prepare = async () => { entered.resolve(); await gate.promise; };
  try {
    const pending = f.api.workspace!.navigate!({ surface: "settings" }); await entered.promise;
    f.switchBook("foreign"); await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    gate.resolve(); expect(f.targets).toEqual([]); expect(f.readers.size).toBe(0);
  } finally { gate.resolve(); await f.close(); }
});

test("a fixed-book grant can open settings over another reader but cannot close that reader", async () => {
  const f = fixture({ mode: "book", bookId: "z-owned" }); f.switchBook("foreign");
  try {
    const commands = await f.api.commands!.list();
    expect(commands.commands.find(command => command.id === "go-shelf")).toMatchObject({ enabled: false, unavailableReason: "object-scope" });
    await expect(f.api.workspace!.navigate!({ surface: "shelf" })).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect((await f.api.workspace!.navigate!({ surface: "settings" })).status).toBe("completed");
  } finally { await f.close(); }
});

test("workspace observations follow the current grant and release host and reader subscriptions", async () => {
  const f = fixture(), seen: unknown[] = [];
  const subscription = f.api.workspace!.observe({ limit: 1 }, snapshot => { seen.push(snapshot?.selection.bookIds); });
  try {
    expect(seen).toEqual([["z-owned"]]); f.switchBook("foreign"); expect(seen.at(-1)).toEqual([]);
    subscription.dispose(); const count = seen.length; f.switchBook("z-owned"); expect(seen).toHaveLength(count); expect(f.readers.size).toBe(0);
  } finally { subscription.dispose(); await f.close(); }
});

test("read-only installations have discovery and snapshots but no command or navigation write surface", async () => {
  const f = fixture({ mode: "book", bookId: "z-owned" }, false);
  try { expect(f.api.commands!.execute).toBeUndefined(); expect(f.api.workspace!.navigate).toBeUndefined(); }
  finally { await f.close(); }
});

test("a fixed-book open cannot continue after another reader replaces its discovery context", async () => {
  const f = fixture({ mode: "book", bookId: "z-owned" }), gate = deferred(), entered = deferred();
  const list = f.commands.list;
  f.commands.list = async () => { entered.resolve(); await gate.promise; return list(); };
  try {
    const pending = f.api.commands!.execute!({ id: "open-book", args: { bookId: "z-owned" } });
    await entered.promise; f.switchBook("foreign"); gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: "plugin/object-access-denied" });
    expect(f.requests).toEqual([]); expect(f.readers.size).toBe(0);
  } finally { gate.resolve(); await f.close(); }
});
