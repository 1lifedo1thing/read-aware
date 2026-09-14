import { expect, test } from "bun:test";
import type { PluginContext, PluginViewUpdate } from "@read-aware/plugin-types";
import { readerDemandDetail } from "../src/reader-demand";

test("reading activity view follows public demand transitions without replaying unrelated session changes", async () => {
  type Session = Awaited<ReturnType<NonNullable<PluginContext["domains"]["reading"]>["queries"]["session"]>>;
  let session = { revision: 1, readerDemand: { active: true, lastActivityAt: 1, idleAt: 1501, reason: "render" } } as Session;
  let callback: ((value: Session) => void | Promise<void>) | undefined;
  let disposed = false;
  const updates: PluginViewUpdate[] = [];
  const ctx = { locale: "en", domains: { reading: { queries: { session: async () => session }, events: { observeSession: (handler: typeof callback) => {
    callback = handler; return { dispose() { disposed = true; callback = undefined; } };
  } } } }, services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => { updates.push(update); return { status: "applied" }; } } } } as unknown as PluginContext;
  ctx.withEvent = ((_event: unknown, registration?: { dispose(): void | Promise<void> }) => registration
    ? Object.assign({}, ctx, { dispose: async () => { await registration.dispose(); } }) : ctx) as PluginContext["withEvent"];
  const view = await readerDemandDetail(ctx);
  expect(view.content[0]).toMatchObject({ rows: expect.arrayContaining([{ label: "Activity", value: "Yielding to reading" }]) });
  const lease = await view.live!.subscribe({ id: "activity" }); await callback!(session);
  session = { ...session, revision: 2 }; await callback!(session); expect(updates).toHaveLength(1);
  session = { ...session, revision: 3, readerDemand: { ...session.readerDemand!, active: false } }; await callback!(session);
  expect(updates).toHaveLength(2); expect(updates[1]!.view).toMatchObject({ content: [{ rows: expect.arrayContaining([{ label: "Activity", value: "No recent render or movement" }]) }] });
  session = { ...session, revision: 4, change: { origin: "plugin:jumper", reason: "navigate" } }; await callback!(session);
  expect(updates).toHaveLength(3);
  expect(updates[2]!.view).toMatchObject({ content: [{ rows: expect.arrayContaining([
    { label: "Latest update", value: "Navigation completed" }, { label: "Update source", value: "Plugin: jumper" },
  ]) }] });
  lease.dispose(); expect(disposed).toBe(true);
});
