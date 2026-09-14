import type { PluginContext, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { adminCopy } from "./admin-strings";
import { liveView } from "./live-view";

type Snapshot = Awaited<ReturnType<PluginContext["services"]["maintenance"]["snapshot"]>>;

export function updateViews(ctx: PluginContext, signal: AbortSignal) {
  const t = adminCopy(ctx.locale), maintenance = ctx.services.maintenance;
  const show = (snapshot: Snapshot): PluginView => liveView(ctx, signal, snapshot,
    handler => maintenance.observe(handler, { ruleId: "updates-live" }), render);
  const render = (snapshot: Snapshot): PluginView => {
    const busy = ["checking", "downloading", "installing"].includes(snapshot.phase);
    return { kind: "detail", title: t.updates, content: [
      { kind: "keyValue", rows: [
        { label: t.status, value: snapshot.supported ? t.phases[snapshot.phase] : t.unsupported },
        { label: t.current, value: snapshot.currentVersion ?? t.unknown },
        { label: t.available, value: snapshot.availableVersion ?? t.unknown },
        { label: t.channel, value: t[snapshot.channel] },
        { label: t.checkedChannel, value: snapshot.checkedChannel ? t[snapshot.checkedChannel] : t.never },
        ...(snapshot.errorStage ? [{ label: t.errorStage, value: snapshot.errorStage === "check" ? t.checkStage : t.installStage }] : []),
      ] },
      ...(snapshot.supported && busy ? [{ kind: "progress" as const, value: snapshot.progress, max: 100, label: t.phases[snapshot.phase] }] : []),
    ], actions: [
      { id: "prerequisites", label: t.prerequisites, run: async () => ({ view: await prerequisites() }) },
      ...(snapshot.supported && !busy && maintenance.checkForUpdates ? [{ id: "check", label: t.check, icon: "arrows-clockwise",
        run: async (): Promise<PluginViewResult> => {
          signal.throwIfAborted();
          const result = await maintenance.checkForUpdates!();
          signal.throwIfAborted();
          return { view: show(result), navigation: "replace" };
        } }] : []),
      { id: "refresh", label: t.refresh, icon: "clock", run: async () => ({ view: await open(), navigation: "replace" as const }) },
      { id: "manage", label: t.manageUpdates, icon: "arrow-square-out", run: async (): Promise<PluginViewResult> => {
        signal.throwIfAborted();
        await maintenance.openSettings("updates");
        return { close: true };
      } },
    ] };
  };
  const prerequisites = async (): Promise<PluginView> => {
    const value = await ctx.services.session.operationAvailability({ operation: "maintenance.checkForUpdates" }, { signal });
    signal.throwIfAborted();
    const reasons: Record<string, string> = { authorized: t.yes, "updater-unsupported": t.unsupported,
      "update-installation-active": t.installationBusy, "update-check-shared": t.shared,
      "update-check-ready": t.ready, "update-server-not-checked": t.serverUnchecked, "service:network-required": t.permissionRequired };
    return { kind: "detail", title: t.prerequisites, content: value.conditions.map(item => ({ kind: "text", text: reasons[item.reason] ?? t.unknown })),
      actions: [
        ...(value.state === "available" || value.state === "unknown" ? [{ id: "check", label: t.check, run: async () => {
          signal.throwIfAborted();
          const result = await maintenance.checkForUpdates!();
          signal.throwIfAborted();
          return { view: show(result), navigation: "replace" as const };
        } }] : []),
        { id: "refresh", label: t.refresh, run: async () => ({ view: await prerequisites(), navigation: "replace" as const }) },
      ] };
  };
  const open = async (): Promise<PluginView> => {
    signal.throwIfAborted();
    const snapshot = await maintenance.snapshot();
    signal.throwIfAborted();
    return show(snapshot);
  };
  return { open };
}
