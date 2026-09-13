import { searchAllBookLocations, type BookLocationSearch, type BookLocationSearchProgress, type PluginListView, type PluginView, type PluginViewChannel, type PluginViewContent } from "@read-aware/plugin-types";
import { tr } from "./strings";
import type { JumperContext } from "./types";

export function textSearchView(ctx: JumperContext, input: BookLocationSearch): PluginView {
  const controller = new AbortController();
  let channel: PluginViewChannel | undefined, revision = 0, started = false, pending = true;
  const retry = { id: "retry", label: tr(ctx.locale, "search"), icon: "magnifying-glass",
    run: () => ({ view: textSearchView(ctx, input), navigation: "replace" as const }) };
  const cancelled = (): PluginViewContent => ({ kind: "list", title: input.query, items: [],
    emptyText: tr(ctx.locale, "cancelled"), actions: [retry] });
  const progress = (value: BookLocationSearchProgress): PluginViewContent => ({ kind: "blocks", title: input.query, blocks: [
    { kind: "progress", value: value.totalSections ? Math.min(value.scannedSections, value.totalSections) : null,
      ...(value.totalSections ? { max: value.totalSections, showValue: true } : {}),
      label: value.totalSections ? `${tr(ctx.locale, "searching")} (${value.scannedSections}/${value.totalSections})` : tr(ctx.locale, "searching"), cancel: {
        id: "cancel", label: tr(ctx.locale, "cancel"), run: async () => { stop(); await publish(); },
      } },
  ] });
  const stop = () => {
    controller.abort();
    if (pending) { pending = false; current = cancelled(); }
  };
  let current: PluginViewContent = { kind: "blocks", title: input.query, blocks: [
    { kind: "progress", value: null, label: tr(ctx.locale, "searching"), cancel: {
      id: "cancel", label: tr(ctx.locale, "cancel"), run: async () => { stop(); await publish(); },
    } },
  ] };
  const publish = async () => {
    if (!channel) return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) { channel = undefined; stop(); }
    } catch (error) {
      // A retired channel cannot display an error; the host diagnostic log remains available.
      console.warn("Jumper search view publication failed", error);
      if (channel === target) { channel = undefined; stop(); }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted) return;
    try {
      const run = await searchAllBookLocations(
        (pageInput, options) => ctx.domains.library.queries.books.searchLocations(pageInput, options),
        input,
        { signal: controller.signal, onProgress: async value => {
          if (controller.signal.aborted || !pending) return;
          current = progress(value);
          await publish();
        } },
      );
      if (controller.signal.aborted) return;
      if (run.status === "cancelled") { pending = false; current = cancelled(); await publish(); return; }
      const emptyKey = run.status === "timed-out" ? "timedOut"
        : run.status === "scan-limit" ? "scanLimit"
          : run.status === "result-limit" ? "resultLimit"
            : run.status === "stale" ? "stale"
              : run.textStatus === "textless" ? "textless"
                : run.textStatus === "unsupported" || run.textStatus === "partial" ? "unsupported" : "noHits";
      const resultTitle = run.status === "completed" ? input.query : `${input.query} · ${tr(ctx.locale, emptyKey)}`;
      const result: PluginListView = { kind: "list", title: resultTitle,
        emptyText: tr(ctx.locale, emptyKey),
        items: run.hits.map(hit => ({ id: hit.id, title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
          icon: "magnifying-glass", onSelect: async () => {
            await ctx.domains.reading.commands.goTo(hit.location);
            return { close: true };
          } })),
        actions: run.status === "timed-out" || run.status === "scan-limit" || run.status === "result-limit" ? [retry] : [],
      };
      current = result;
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = { kind: "blocks", title: input.query, blocks: [{ kind: "error", code },
        ...(retryable ? [{ kind: "actions" as const, actions: [retry] }] : [])] };
    }
    pending = false;
    await publish();
  };
  return { ...current, onClose: stop, live: { subscribe(next) {
    channel = next;
    if (!started) { started = true; void search(); }
    else void publish();
    return { dispose() { if (channel === next) { channel = undefined; stop(); } } };
  } } };
}
