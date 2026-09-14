import type { PluginContext, PluginDetailView, PluginListView, PluginAction } from "@read-aware/plugin-types";
import { tr } from "./strings";

async function jobDetail(ctx: PluginContext, id: string): Promise<PluginDetailView> {
  const job = await ctx.services.jobs.get(id);
  const refresh = async () => ({ view: await jobDetail(ctx, id), navigation: "replace" as const });
  const actions: PluginAction[] = [{ id: "refresh", label: tr(ctx.locale, "refresh"), run: refresh }];
  if (!["completed", "cancelled"].includes(job.status)) {
    for (const action of (job.status === "running" || job.status === "queued" ? ["pause", "cancel"] : ["resume", "cancel"]) as Array<"pause" | "resume" | "cancel">) {
      actions.push({ id: action, label: tr(ctx.locale, `${action}Request`), run: async () => { await ctx.services.jobs.control(id, action); return refresh(); } });
    }
  }
  return { kind: "detail", title: job.title, content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "status"), value: job.status === "needs-attention" ? tr(ctx.locale, "jobAttention") : tr(ctx.locale, `task_${job.status}`) },
    { label: tr(ctx.locale, "durableJobs"), value: `${job.completedSteps} / ${job.totalSteps}` },
    ...(job.errorCode ? [{ label: tr(ctx.locale, "jobAttention"), value: job.errorCode }] : []),
  ] }], actions };
}
export async function savedJobs(ctx: PluginContext, offset = 0): Promise<PluginListView> {
  const page = await ctx.services.jobs.list({ offset, limit: 20 });
  const actions: PluginAction[] = [{ id: "refresh", label: tr(ctx.locale, "refresh"), run: async () => ({ view: await savedJobs(ctx, offset), navigation: "replace" }) }];
  if (page.nextOffset !== null) actions.push({ id: "next", label: tr(ctx.locale, "next"), run: async () => ({ view: await savedJobs(ctx, page.nextOffset!), navigation: "replace" }) });
  if (offset) actions.push({ id: "previous", label: tr(ctx.locale, "previous"), run: async () => ({ view: await savedJobs(ctx, Math.max(0, offset - 20)), navigation: "replace" }) });
  return { kind: "list", title: tr(ctx.locale, "durableJobs"), items: page.jobs.map(job => ({ id: job.id, title: job.title,
    subtitle: `${job.completedSteps} / ${job.totalSteps}`, onSelect: async () => ({ view: await jobDetail(ctx, job.id) }) })), actions, emptyText: tr(ctx.locale, "empty") };
}
