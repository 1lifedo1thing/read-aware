import type { PluginContext, PluginDetailView, PluginView, PluginLibraryDomain } from "@read-aware/plugin-types";
import { assetStrings } from "./assets-strings";
import { bookAssets } from "./book-assets";
type Task = Awaited<ReturnType<PluginLibraryDomain["queries"]["books"]["getImportTask"]>>;
export function importTask(ctx: PluginContext, initial: Task, resourceId?: string): PluginView & PluginDetailView {
  const library = ctx.domains.library!, t = assetStrings(ctx.locale);
  let task = initial;
  const view = (): PluginDetailView => ({ kind: "detail", title: task.receipt?.book.title ?? task.sourceName,
    content: task.receipt ? [{ kind: "text", text: task.receipt.status === "duplicate" ? t.duplicate : t.imported }]
      : [{ kind: "text", text: t[task.phase] }, ...(task.errorCode ? [{ kind: "error" as const, code: task.errorCode }] : [])],
    actions: task.receipt ? [{ id: "details", label: t.details, icon: "book-open", run: async () => ({ view: await bookAssets(ctx, task.receipt!.book) }) }]
      : [
        { id: "refresh", label: t.refresh, run: async () => ({ view: importTask(ctx, await library.queries.books.getImportTask(task.taskId)), navigation: "replace" }) },
        ...(task.cancellable && !task.cancelRequested ? [{ id: "cancel", label: t.cancel, run: async () => ({ view: importTask(ctx, await library.commands!.books.cancelImportTask(task.taskId)), navigation: "replace" as const }) }] : []),
      ],
  });
  return { ...view(), onClose: resourceId ? () => ctx.services.resources.release(resourceId) : undefined, live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = library.events.observeImportTask(task.taskId, async (snapshot, delivery) => {
      if (disposed || delivery?.reaction?.status === "cycle") return;
      task = snapshot;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: ++revision, view: view() });
    }, { ruleId: "import-task-live" });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
