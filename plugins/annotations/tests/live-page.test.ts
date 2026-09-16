import { expect, test } from "bun:test";
import type { AnnotationObservation, AnnotationPageQuery, PluginViewUpdate, PluginReactionEvent } from "@read-aware/plugin-types";
import { liveAnnotationPage } from "../src/live-page";
import type { AnnotationContext } from "../src/types";

function fixture() {
  let handler!: (event: AnnotationObservation, delivery?: PluginReactionEvent) => unknown, stopped = false;
  const updates: PluginViewUpdate[] = [];
  const page = { items: [], nextCursor: null, consistency: "live" as const };
  const ctx = { locale: "en", domains: { annotations: { queries: { page: async () => page }, events: {
    observe: (_query: unknown, callback: typeof handler) => { handler = callback; return { dispose() { stopped = true; } }; },
  } } }, services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => { updates.push(update); } } } } as unknown as AnnotationContext;
  const bound: (PluginReactionEvent | undefined)[] = [];
  ctx.withEvent = ((event: PluginReactionEvent | undefined) => { bound.push(event); return ctx; }) as AnnotationContext["withEvent"];
  return { ctx, page, updates, bound, emit: (event: AnnotationObservation, delivery?: PluginReactionEvent) => handler(event, delivery), stopped: () => stopped };
}

test("automatic publication binds the delivery while repeated causal reactions stop before rendering", async () => {
  const f = fixture(), calls: string[] = [];
  const view = await liveAnnotationPage(f.ctx, {}, async () => { calls.push("render"); return { kind: "list", items: [] }; });
  const bound = { ...f.ctx, services: { ...f.ctx.services, ui: { ...f.ctx.services.ui,
    publishView: async () => { calls.push("bound publication"); return { status: "applied" as const }; },
  } } };
  f.ctx.withEvent = ((delivery: PluginReactionEvent | undefined) => { f.bound.push(delivery); return bound as AnnotationContext; }) as AnnotationContext["withEvent"];
  const sub = await view.live!.subscribe({ id: "channel" });
  const event = { status: "ready" as const, revision: 1, result: { kind: "page" as const, page: f.page } };
  const delivery = { reaction: { id: "host-lease", status: "ready" as const } };
  await f.emit(event, delivery);
  expect(f.bound).toEqual([delivery]); expect(f.updates).toEqual([]);
  await f.emit({ ...event, revision: 2 }, { reaction: { id: "cycle", status: "cycle" } });
  expect(calls).toEqual(["render", "render", "bound publication"]); sub.dispose();
});
test("live pages clear stale actions on error and restore fresh snapshots without leaking raw errors", async () => {
  const f = fixture(); let title = "initial";
  const view = await liveAnnotationPage(f.ctx, {}, async () => ({ kind: "list", title, items: [], actions: [{ id: "old", label: "Select", run() {} }] }));
  const sub = await view.live!.subscribe({ id: "channel" });
  await f.emit({ revision: 1, status: "error", errorCode: "db/locked" });
  expect(f.updates[0]!.view).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "db/locked" }] });
  expect(f.updates[0]!.view).not.toHaveProperty("actions");
  title = "new snapshot"; await f.emit({ revision: 2, status: "ready", result: { kind: "page", page: f.page } });
  expect(f.updates[1]!.view).toMatchObject({ kind: "list", title: "new snapshot" });
  sub.dispose(); await f.emit({ revision: 3, status: "error", errorCode: "late" });
  expect(f.updates).toHaveLength(2); expect(f.stopped()).toBe(true);
});
test("joined read failure stays unacknowledged so unchanged pages can recover", async () => {
  const f = fixture(); let failed = true;
  const view = await liveAnnotationPage(f.ctx, {}, async () => {
    if (failed) throw Object.assign(Error("PRIVATE_BOOK_READ"), { code: "db/locked" });
    return { kind: "list", title: "Recovered", items: [] };
  });
  expect(JSON.stringify(view)).not.toContain("PRIVATE_BOOK_READ");
  const sub = await view.live!.subscribe({ id: "channel" });
  const event = { revision: 1, status: "ready" as const, result: { kind: "page" as const, page: f.page } };
  await expect(f.emit(event)).rejects.toThrow("PRIVATE_BOOK_READ");
  expect(f.updates[0]!.view).toMatchObject({ kind: "detail" });
  failed = false; await f.emit({ ...event, revision: 2 });
  expect(f.updates[1]!.view).toMatchObject({ kind: "list", title: "Recovered" }); sub.dispose();
});
test("disposal during async rendering drops the late result and the query is frozen", async () => {
  const f = fixture(); let resolve: (() => void) | undefined, hold = false;
  const input: AnnotationPageQuery = { bookId: "b", limit: 20 };
  let observed: unknown;
  const observe = f.ctx.domains.annotations.events.observe;
  f.ctx.domains.annotations.events.observe = (query, callback) => { observed = query; return observe(query, callback); };
  const view = await liveAnnotationPage(f.ctx, input, async () => { if (hold) await new Promise<void>(r => { resolve = r; }); return { kind: "list", items: [] }; });
  input.bookId = "other"; const sub = await view.live!.subscribe({ id: "channel" }); expect(observed).toMatchObject({ query: { bookId: "b" } });
  hold = true; const work = f.emit({ revision: 1, status: "ready", result: { kind: "page", page: f.page } });
  await Promise.resolve(); sub.dispose(); resolve!(); await work;
  expect(f.updates).toHaveLength(0);
});


test("oversized annotation errors render without editable partial text", async () => {
  const f = fixture();
  f.ctx.domains.annotations.queries.page = async () => { throw Object.assign(Error("PRIVATE_LARGE_NOTE"), { code: "annotations/read-budget-exceeded" }); };
  const view = await liveAnnotationPage(f.ctx, {}, async () => ({ kind: "list", items: [] }));
  expect(view).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "annotations/read-budget-exceeded" }] });
  expect(JSON.stringify(view)).not.toContain("PRIVATE_LARGE_NOTE");
  expect(view).not.toHaveProperty("actions");
});
