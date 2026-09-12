import type { BookTextTaskHistoryEntry, PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { requestDetail, startRequest } from "./task-views";
import { tr } from "./strings";
function entryView(ctx: PluginContext, title: string, entry: BookTextTaskHistoryEntry): PluginDetailView {
  const task = entry.snapshot;
  return { kind: "detail", title, content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "request"), value: tr(ctx.locale, entry.interrupted ? "taskInterrupted" : `task_${task.status}`) },
    { label: tr(ctx.locale, "mode"), value: tr(ctx.locale, task.mode) },
    { label: tr(ctx.locale, "recordedAt"), value: new Date(entry.recordedAt).toLocaleString(ctx.locale) },
    ...(task.errorCode === "library/text-timeout" ? [{ label: tr(ctx.locale, "failure"), value: tr(ctx.locale, "taskTimeout") }] : []),
    ...(task.textState.progress ? [{ label: tr(ctx.locale, "sections"), value: `${task.textState.progress.completed} / ${task.textState.progress.total}` }] : []),
  ] }], actions: entry.requestAvailable ? [{ id: "current", label: tr(ctx.locale, "request"), icon: "arrow-right",
    run: async () => ({ view: await requestDetail(ctx, task.bookId, title, task.taskId) }) }] : [{ id: "prepare", label: tr(ctx.locale, "prepare"), icon: "play",
    run: () => startRequest(ctx, task.bookId, title) }] };
}
export async function taskHistory(ctx: PluginContext, bookId: string, title: string, offset = 0): Promise<PluginListView> {
  const page = await ctx.domains.library!.queries.books.listTextTaskHistory(bookId, { offset, limit: 20 });
  return { kind: "list", title: `${title} · ${tr(ctx.locale, "taskHistory")}`, emptyText: tr(ctx.locale, "noHistory"),
    items: page.items.map(entry => ({ id: entry.snapshot.taskId, title: tr(ctx.locale, entry.snapshot.mode),
      subtitle: tr(ctx.locale, entry.interrupted ? "taskInterrupted" : `task_${entry.snapshot.status}`), timestamp: entry.recordedAt,
      onSelect: () => ({ view: entryView(ctx, title, entry) }) })),
    actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await taskHistory(ctx, bookId, title), navigation: "replace" }) },
      ...(offset > 0 ? [{ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: async () => ({ view: await taskHistory(ctx, bookId, title, Math.max(0, offset - 20)), navigation: "replace" as const }) }] : []),
      ...(page.nextOffset !== null ? [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: async () => ({ view: await taskHistory(ctx, bookId, title, page.nextOffset!), navigation: "replace" as const }) }] : [])] };
}
