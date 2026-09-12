import type { PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";

type Receipt = NonNullable<Awaited<ReturnType<NonNullable<PluginContext["services"]["llm"]>["getRequest"]>>>;
const status = (ctx: PluginContext, receipt: Receipt) => tr(ctx.locale, receipt.interrupted ? "taskInterrupted"
  : receipt.status === "timed-out" ? "requestTimedOut" : `task_${receipt.status}`);

export async function inferenceHistory(ctx: PluginContext): Promise<PluginListView> {
  const receipts = await ctx.services.llm!.listRequests();
  return { kind: "list", title: tr(ctx.locale, "inferenceHistory"), emptyText: tr(ctx.locale, "noInferenceHistory"),
    items: receipts.slice().reverse().map(receipt => ({ id: receipt.requestId, title: status(ctx, receipt),
      subtitle: new Date(receipt.createdAt).toLocaleString(ctx.locale), icon: "sparkle",
      onSelect: async () => ({ view: await inferenceDetail(ctx, receipt.requestId) }) })),
    actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
      run: async () => ({ view: await inferenceHistory(ctx), navigation: "replace" }) }],
  };
}
async function inferenceDetail(ctx: PluginContext, id: string): Promise<PluginDetailView> {
  const receipt = await ctx.services.llm!.getRequest(id);
  if (!receipt) return { kind: "detail", title: tr(ctx.locale, "inferenceHistory"), content: [{ kind: "text", text: tr(ctx.locale, "noInferenceHistory") }] };
  const unknown = tr(ctx.locale, "unknown");
  return { kind: "detail", title: status(ctx, receipt), content: [
    { kind: "keyValue", rows: [{ label: "ID", value: receipt.requestId },
      { label: tr(ctx.locale, "recordedAt"), value: new Date(receipt.updatedAt).toLocaleString(ctx.locale) },
      { label: tr(ctx.locale, "inferenceSettlement"), value: tr(ctx.locale, receipt.settled ? "task_completed" : "unknown") },
      ...(receipt.errorCode ? [{ label: tr(ctx.locale, "status"), value: receipt.errorCode }] : [])] },
    ...receipt.attempts.map(attempt => ({ kind: "keyValue" as const, rows: [
      { label: tr(ctx.locale, "inferenceModel"), value: `${attempt.model.provider} · ${attempt.model.id}` },
      { label: tr(ctx.locale, "inferenceInput"), value: attempt.usage?.input == null ? unknown : String(attempt.usage.input) },
      { label: tr(ctx.locale, "inferenceOutput"), value: attempt.usage?.output == null ? unknown : String(attempt.usage.output) },
      { label: tr(ctx.locale, "inferenceCost"), value: attempt.estimatedCostUsd === null ? unknown : `$${attempt.estimatedCostUsd.toFixed(6)}` },
    ] })),
  ], actions: [
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await inferenceDetail(ctx, id), navigation: "replace" }) },
    ...(receipt.requestAvailable && receipt.status === "running" ? [{ id: "cancel", label: tr(ctx.locale, "cancelRequest"), icon: "stop", run: async () => {
      await ctx.services.llm!.cancelRequest(id); return { view: await inferenceDetail(ctx, id), navigation: "replace" as const };
    } }] : []),
  ] };
}
