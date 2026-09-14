import type { PluginContext, PluginView, PluginDetailView, PluginLibraryDomain } from "@read-aware/plugin-types";
import { tr } from "./strings";

type State = Awaited<ReturnType<PluginLibraryDomain["queries"]["books"]["getContentState"]>>;
export async function contentState(ctx: PluginContext, bookId: string, title: string): Promise<PluginDetailView & PluginView> {
  let state: State = await ctx.domains.library!.queries.books.getContentState(bookId), failure: string | undefined;
  const view = (): PluginDetailView => ({ kind: "detail", title: `${title} / ${tr(ctx.locale, "contentSource")}`,
    content: failure ? [{ kind: "error", code: failure }] : [{ kind: "keyValue", rows: [
      { label: tr(ctx.locale, "contentSource"), value: tr(ctx.locale, state.source === "file" ? "sourceFile" : "sourcePlugin") },
      { label: tr(ctx.locale, "status"), value: tr(ctx.locale, state.availability === "local" ? "sourceLocal"
        : state.availability === "missing" ? "sourceMissing" : state.availability === "provider-registered" ? "sourceRegistered" : "sourceUnavailable") },
    ] }], actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), run: async () => ({ view: await contentState(ctx, bookId, title), navigation: "replace" }) }],
  });
  return { ...view(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.domains.library!.events.observeContentState(bookId, async (event, delivery) => {
      if (disposed || delivery?.reaction?.status === "cycle") return;
      if (event.status === "ready") { state = event.snapshot; failure = undefined; } else failure = event.errorCode;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: ++revision, view: view() });
    }, { ruleId: "content-source-live" });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
