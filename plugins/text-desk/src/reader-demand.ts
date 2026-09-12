import type { PluginContext, PluginDetailView, PluginView } from "@read-aware/plugin-types";
import { tr } from "./strings";

type Session = Awaited<ReturnType<NonNullable<PluginContext["domains"]["reading"]>["queries"]["session"]>>;
function snapshot(ctx: PluginContext, session: Session): PluginDetailView {
  const demand = session.readerDemand;
  return { kind: "detail", title: tr(ctx.locale, "readerActivity"), content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "activityState"), value: tr(ctx.locale, !demand ? "unavailable" : demand.active ? "readerWait" : "readerIdle") },
    ...(demand?.reason ? [{ label: tr(ctx.locale, "activitySource"), value: tr(ctx.locale, demand.reason === "render" ? "renderActivity" : "relocateActivity") }] : []),
  ] }] };
}
export async function readerDemandDetail(ctx: PluginContext): Promise<PluginDetailView & Pick<PluginView, "live">> {
  const reading = ctx.domains.reading!;
  const current = await reading.queries.session();
  return { ...snapshot(ctx, current), live: { subscribe: channel => {
    let previous: string | undefined;
    return reading.events.observeSession(async session => {
      const next = JSON.stringify(session.readerDemand);
      if (previous === next) return;
      await ctx.services.ui.publishView(channel, { revision: session.revision, view: snapshot(ctx, session) });
      previous = next;
    });
  } } };
}
