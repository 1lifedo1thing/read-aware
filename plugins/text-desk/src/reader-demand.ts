import type { PluginContext, PluginDetailView, PluginView } from "@read-aware/plugin-types";
import { tr } from "./strings";

type Session = Awaited<ReturnType<NonNullable<PluginContext["domains"]["reading"]>["queries"]["session"]>>;
function changeOrigin(ctx: PluginContext, origin: NonNullable<Session["change"]>["origin"]): string {
  return origin === "system" ? tr(ctx.locale, "originHost") : origin === "user" ? tr(ctx.locale, "originUser")
    : origin === "agent" ? tr(ctx.locale, "originAgent") : `${tr(ctx.locale, "originPlugin")}: ${origin.slice(7)}`;
}
const reasonLabel = {
  initial: "changeLifecycle", open: "changeLifecycle", ready: "changeLifecycle", detach: "changeLifecycle", error: "changeLifecycle", close: "changeLifecycle",
  relocate: "relocateActivity", navigate: "changeNavigation", back: "changeNavigation", forward: "changeNavigation", step: "changeNavigation", reload: "changeNavigation",
  "mode-step": "changeNavigation", "mode-return": "changeNavigation", selection: "changeSelection", controls: "changeControls", mode: "changeMode", playback: "changePlayback", "reader-demand": "readerActivity",
} as const satisfies Record<NonNullable<Session["change"]>["reason"], Parameters<typeof tr>[1]>;
function snapshot(ctx: PluginContext, session: Session): PluginDetailView {
  const demand = session.readerDemand, change = session.change;
  return { kind: "detail", title: tr(ctx.locale, "readerActivity"), content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "activityState"), value: tr(ctx.locale, !demand ? "unavailable" : demand.active ? "readerWait" : "readerIdle") },
    ...(demand?.reason ? [{ label: tr(ctx.locale, "activitySource"), value: tr(ctx.locale, demand.reason === "render" ? "renderActivity" : "relocateActivity") }] : []),
    ...(change ? [
      { label: tr(ctx.locale, "changeReason"), value: tr(ctx.locale, reasonLabel[change.reason]) },
      { label: tr(ctx.locale, "changeOrigin"), value: changeOrigin(ctx, change.origin) },
    ] : []),
  ] }] };
}
export async function readerDemandDetail(ctx: PluginContext): Promise<PluginDetailView & Pick<PluginView, "live">> {
  const reading = ctx.domains.reading!;
  const current = await reading.queries.session();
  return { ...snapshot(ctx, current), live: { subscribe: channel => {
    let previous: string | undefined;
    return reading.events.observeSession(async session => {
      const next = JSON.stringify([session.readerDemand, session.change]);
      if (previous === next) return;
      await ctx.services.ui.publishView(channel, { revision: session.revision, view: snapshot(ctx, session) });
      previous = next;
    });
  } } };
}
