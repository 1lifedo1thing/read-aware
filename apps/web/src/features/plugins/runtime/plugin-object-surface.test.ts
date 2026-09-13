import { expect, spyOn, test } from "bun:test";
import type { PluginPermission } from "@read-aware/plugin-types";
import { buildPluginContext } from "./plugin-context";
import * as domain from "../../../domain";

test("fixed-book library lists remain available without opening the granted book", async () => {
  const original = domain.createActorDomainView;
  const spy = spyOn(domain, "createActorDomainView").mockImplementation((...args) => {
    const view = original(...args);
    if (view.library) view.library.queries.books.list = async () => ["book-a", "book-b"].map(id => ({
      id, title: id, format: "epub" as const, starred: false, collectionId: null,
      addedAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z",
    }));
    return view;
  });
  const actor = buildPluginContext({ id: "fixed-list-proof", name: "Fixed list", version: "1.0.0",
    schemaVersion: 1, requires: {}, permissions: ["library:read"] }, "1.0.0", [], { mode: "book", bookId: "book-a" });
  actor.lifecycle.promote();
  try {
    expect((await actor.context.domains.library!.queries.books.list()).map(book => book.id)).toEqual(["book-a"]);
  } finally {
    spy.mockRestore(); actor.lifecycle.stop(); await actor.lifecycle.drainCleanups();
  }
});

test("the production plugin context exposes book-scoped memory with write grants kept separate", async () => {
  const original = domain.createActorDomainView;
  const spy = spyOn(domain, "createActorDomainView").mockImplementation((...args) => {
    const view = original(...args);
    if (view.memory) view.memory.queries.page = async query => ({
      items: [], total: 0, offset: 0, nextOffset: null, revision: query.scopes.join(","),
    });
    return view;
  });
  const actor = buildPluginContext({ id: "fixed-memory-proof", name: "Fixed memory", version: "1.0.0",
    schemaVersion: 1, requires: {}, permissions: ["memory:read"] }, "1.0.0", [], { mode: "book", bookId: "book-a" });
  actor.lifecycle.promote();
  try {
    expect(actor.context.domains.memory!.commands).toBeUndefined();
    expect((await actor.context.domains.memory!.queries.page({ scopes: ["book:book-a"] })).revision).toBe("book:book-a");
    expect(() => actor.context.domains.memory!.queries.page({ scopes: ["book:book-b"] })).toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
  } finally { spy.mockRestore(); actor.lifecycle.stop(); await actor.lifecycle.drainCleanups(); }
});

test.each(([[], ["reading:read"], ["annotations:read"]] as PluginPermission[][]).map(permissions => ({ permissions })))(
  "restricted workspace cannot bypass object grants without library permission: %j", async ({ permissions }) => {
    const actor = buildPluginContext({ id: "object-surface-proof", name: "Object scope", version: "1.0.0",
      schemaVersion: 1, requires: {}, permissions }, "1.0.0", [], { mode: "book", bookId: "book-a" });
    actor.lifecycle.promote();
    try {
      expect(actor.context.domains.library).toBeUndefined();
      const { workspace, commands } = actor.context.services.ui;
      if (!workspace || !commands) throw new Error("Expected guarded host surfaces");
      const calls: Array<() => Promise<unknown>> = [() => workspace.snapshot(), () => commands.list()];
      for (const invoke of calls) {
        await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({ code: "plugin/object-access-denied" });
      }
    } finally {
      actor.lifecycle.stop();
      await actor.lifecycle.drainCleanups();
    }
  },
);
