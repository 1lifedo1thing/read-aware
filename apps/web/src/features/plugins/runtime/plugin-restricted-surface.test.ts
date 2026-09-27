import { afterEach, expect, spyOn, test } from "bun:test";
import type { PluginBookAccess, PluginPermission } from "@read-aware/plugin-types";
import * as domain from "../../../domain";
import { PLUGIN_OBJECT_ACCESS_DENIED } from "../../../domain/plugin-object-access";
import { buildPluginContext, type PluginContextRuntime } from "./plugin-context";
import { describeContext } from "./plugin-worker-host";
import { restrictedPolicyOf } from "./plugin-restricted-surface";

const permissions: PluginPermission[] = [
  "library:write", "reading:write", "annotations:write", "conversations:write", "memory:write",
  "service:network", "service:llm",
];
const grants: PluginBookAccess[] = [{ mode: "book", bookId: "book-a" }, { mode: "current" }];

/** Every domain write the host could dispatch, replaced by a recorder. */
const dispatched: string[] = [];
const recordTree = <T extends object>(value: T, path: string): T => Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
  typeof entry === "function"
    ? (...args: unknown[]) => { dispatched.push(`${path}.${key}`); return Promise.resolve(fakeResult(key, args)); }
    : entry && typeof entry === "object" ? recordTree(entry, `${path}.${key}`) : entry,
])) as T;
const fakeResult = (key: string, args: unknown[]) => key === "update" || key === "resetReading"
  ? { changed: args[0], settings: { settings: [], overrides: [], revision: 1 } }
  : undefined;

const spies: { mockRestore(): void }[] = [];
const runtimes: PluginContextRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); }
  for (const spy of spies.splice(0)) spy.mockRestore();
  dispatched.length = 0;
});

function build(access: PluginBookAccess, granted = permissions): PluginContextRuntime {
  if (!spies.length) {
    const view = domain.createActorDomainView, settings = domain.createSettingsDomain;
    spies.push(spyOn(domain, "createActorDomainView").mockImplementation((...args) => {
      const result = view(...args) as Record<string, { commands?: object } | undefined>;
      for (const [id, entry] of Object.entries(result)) if (entry?.commands) entry.commands = recordTree(entry.commands, `domain.${id}.commands`);
      return result as ReturnType<typeof view>;
    }));
    spies.push(spyOn(domain, "createSettingsDomain").mockImplementation((...args) => {
      const real = settings(...args);
      return { ...real, commands: recordTree(real.commands, "domain.settings.commands") };
    }));
  }
  const runtime = buildPluginContext({ id: `restricted-parity-${access.mode}`, name: "Restricted parity", version: "1.0.0",
    schemaVersion: 1, requires: {}, permissions: granted, settingsAccess: { discover: ["*"], read: ["*"], write: ["*"] } },
  "1.0.0", [], access);
  runtimes.push(runtime);
  return runtime;
}

type Leaf = { path: string; owner: Record<string, unknown>; key: string; fn: (...args: unknown[]) => unknown };
function leaves(value: object, path: string): Leaf[] {
  return Object.entries(value).flatMap(([key, entry]) => typeof entry === "function"
    ? [{ path: `${path}.${key}`, owner: value as Record<string, unknown>, key, fn: entry as Leaf["fn"] }]
    : entry && typeof entry === "object" ? leaves(entry, `${path}.${key}`) : []);
}

/** Invoke with no arguments; commands must refuse before looking at them. */
async function outcome(fn: Leaf["fn"]): Promise<unknown> {
  try { await fn(); } catch (error) { return error; }
  return undefined;
}

const isLifecycleOrDenied = (error: unknown) => error instanceof Error
  && (/is unavailable while plugin is (activating|migrating)/.test(error.message)
    || (error as { code?: string }).code === PLUGIN_OBJECT_ACCESS_DENIED);

test.each(grants.map(access => ({ access })))("restricted domains expose the unrestricted shape, fully classified: $access.mode", ({ access }) => {
  const unrestricted = build({ mode: "all" }), scoped = build(access);
  expect(describeContext(scoped.context).domains).toEqual(describeContext(unrestricted.context).domains);
  const methods = leaves(scoped.context.domains, "domains");
  expect(methods.length).toBeGreaterThan(100);
  for (const method of methods) {
    const kind = restrictedPolicyOf(method.owner, method.key);
    expect({ method: method.path, classified: kind !== undefined }).toEqual({ method: method.path, classified: true });
    // Nothing under commands may be classified as a read or an observer.
    if (method.path.includes(".commands.")) expect({ method: method.path, kind }).toEqual({ method: method.path, kind: expect.stringMatching(/^(command|deny)$/) });
  }
});

test.each([{ mode: "all" } as PluginBookAccess, ...grants].flatMap(access =>
  (["activating", "migrating"] as const).map(phase => ({ access, phase }))))(
  "every state-changing method rejects before dispatch while $phase: $access.mode", async ({ access, phase }) => {
    const runtime = build(access);
    if (phase === "migrating") runtime.lifecycle.beginMigration();
    const commands = Object.entries(runtime.context.domains).flatMap(([id, entry]) =>
      entry && "commands" in entry && entry.commands ? leaves(entry.commands, `domains.${id}.commands`) : []);
    expect(commands.length).toBeGreaterThan(50);
    for (const command of commands) {
      const error = await outcome(command.fn);
      expect({ method: command.path, refused: isLifecycleOrDenied(error) }).toEqual({ method: command.path, refused: true });
    }
    expect(dispatched).toEqual([]);
  },
);

test.each(grants.map(access => ({ access })))("global settings writes wait for promotion under a $access.mode grant", async ({ access }) => {
  const runtime = build(access);
  const settings = runtime.context.domains.settings.commands;
  const change = [{ path: "appearance.theme", value: "dark" }];
  expect(() => settings.update(change)).toThrow("is unavailable while plugin is activating");
  expect(() => settings.resetReading({ target: { kind: "global" }, mode: "defaults" } as never)).toThrow("is unavailable while plugin is activating");
  runtime.lifecycle.beginMigration();
  expect(() => settings.update(change)).toThrow("is unavailable while plugin is migrating");
  runtime.lifecycle.finishMigration();
  expect(dispatched).toEqual([]);
  runtime.lifecycle.promote();
  expect((await settings.update(change)).settings.overrides).toEqual([]);
  expect(dispatched).toEqual(["domain.settings.commands.update"]);
});

test("restricted plugin-owned option providers require the active phase like unrestricted ones", async () => {
  const unrestricted = build({ mode: "all" }), scoped = build({ mode: "book", bookId: "book-a" });
  for (const runtime of [unrestricted, scoped]) {
    expect(() => runtime.context.domains.settings.queries.options({ path: "plugins.other.field" })).toThrow("is unavailable while plugin is activating");
  }
});

test("restricted discovery cannot name a book outside the grant", () => {
  const scoped = build({ mode: "book", bookId: "book-a" });
  scoped.lifecycle.promote();
  expect(() => scoped.context.domains.settings.queries.discover({ target: { kind: "book", bookId: "book-b" } }))
    .toThrow(expect.objectContaining({ code: PLUGIN_OBJECT_ACCESS_DENIED }));
});

test("restricted annotation ranges keep the unrestricted library-permission rule", async () => {
  const input = { bookId: "book-a", text: "quote", body: "note", range: { bookId: "book-a" } } as never;
  for (const access of [{ mode: "all" }, { mode: "book", bookId: "book-a" }] as PluginBookAccess[]) {
    const runtime = build(access, ["annotations:write"]);
    runtime.lifecycle.promote();
    const commands = runtime.context.domains.annotations!.commands!;
    await expect(Promise.resolve().then(() => commands.createHighlight(input))).rejects.toMatchObject({ code: "annotations/forbidden" });
    await expect(Promise.resolve().then(() => commands.createNote(input))).rejects.toMatchObject({ code: "annotations/forbidden" });
  }
  expect(dispatched).toEqual([]);
});
