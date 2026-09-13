import { searchAllBookLocations, type BookLocationSearch, type BookLocationSearchProgress, type BookLocationSearchRun, type BookLocationSearchRunOptions, type BookRangeQuery, type BookTextRange, type PluginContext, type PluginDetailView, type PluginFormView, type PluginListView, type PluginView, type PluginViewChannel, type PluginViewContent } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { ensureReadingSession } from "./reader-session";
import { markPassages } from "./emphasis-views";

export async function capturedRangeDetail(ctx: PluginContext, range?: BookTextRange | null): Promise<PluginDetailView> {
  if (range) return rangeDetail(ctx, { range });
  return { kind: "detail", title: tr(ctx.locale, "passage"), content: [{ kind: "text", text: tr(ctx.locale, "noSourceRange") }] };
}

export function rangeSearchForm(ctx: PluginContext, bookId: string): PluginFormView {
  return { kind: "form", title: tr(ctx.locale, "findPassage"), fields: [
    { kind: "text", id: "query", label: tr(ctx.locale, "passage") },
    { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false },
    { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false },
  ], submitLabel: tr(ctx.locale, "search"), onSubmit: async values => {
    const query = String(values.query ?? "").trim();
    if (!query || query.length > 500) return { fieldErrors: { query: tr(ctx.locale, "invalidPassage") } };
    return { view: rangeSearchTask(ctx, { bookId, query, matchCase: values.matchCase === true, wholeWords: values.wholeWords === true, limit: 20 }) };
  } };
}

function rangeList(ctx: PluginContext, input: BookLocationSearch, run: BookLocationSearchRun): PluginListView {
  const emptyKey = run.status === "cancelled" ? "searchCancelled"
    : run.status === "timed-out" ? "timedOut"
      : run.status === "scan-limit" ? "scanLimit"
        : run.status === "result-limit" ? "resultLimit"
          : run.status === "stale" ? "stale"
            : run.textStatus === "available" ? "noPassageMatches"
              : run.textStatus === "textless" ? "textless" : "unsupportedSections";
  const title = run.status === "completed" ? input.query : `${input.query} · ${tr(ctx.locale, emptyKey)}`;
  return { kind: "list", title, emptyText: tr(ctx.locale, emptyKey),
    items: run.hits.map(hit => ({ id: hit.id, title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post, icon: "magnifying-glass",
      subtitle: `${tr(ctx.locale, "sourceSection")} ${hit.sectionIndex + 1} · ${hit.id}`,
      onSelect: async () => ({ view: await rangeDetail(ctx, { range: hit.range }) }) })),
    actions: [
      ...(run.hits.length ? [{ id: "mark-results", label: tr(ctx.locale, "markResults"), icon: "text-aa",
        run: () => markPassages(ctx, run.hits.map(hit => hit.range)) }] : []),
      ...(run.status === "timed-out" || run.status === "scan-limit" || run.status === "result-limit" ? [{ id: "retry", label: tr(ctx.locale, "search"), icon: "magnifying-glass",
        run: () => ({ view: rangeSearchTask(ctx, input), navigation: "replace" as const }) }] : []),
    ],
  };
}

export async function rangeResults(ctx: PluginContext, input: BookLocationSearch, options?: BookLocationSearchRunOptions): Promise<PluginListView> {
  const run = await searchAllBookLocations(
    (pageInput, pageOptions) => ctx.domains.library!.queries.books.searchLocations(pageInput, pageOptions),
    input,
    options,
  );
  return rangeList(ctx, input, run);
}

function progressView(ctx: PluginContext, input: BookLocationSearch, value: BookLocationSearchProgress,
  cancel: () => Promise<void>): PluginViewContent {
  return { kind: "blocks", title: input.query, blocks: [{ kind: "progress",
    value: value.totalSections ? Math.min(value.scannedSections, value.totalSections) : null,
    ...(value.totalSections ? { max: value.totalSections, showValue: true } : {}),
    label: value.totalSections ? `${tr(ctx.locale, "searching")} (${value.scannedSections}/${value.totalSections})` : tr(ctx.locale, "searching"),
    cancel: { id: "cancel", label: tr(ctx.locale, "cancelRequest"), run: cancel } }] };
}

export function rangeSearchTask(ctx: PluginContext, input: BookLocationSearch): PluginView {
  const controller = new AbortController();
  let channel: PluginViewChannel | undefined, revision = 0, started = false, pending = true;
  const retry = { id: "retry", label: tr(ctx.locale, "search"), icon: "magnifying-glass",
    run: () => ({ view: rangeSearchTask(ctx, input), navigation: "replace" as const }) };
  const cancelled = (): PluginViewContent => ({ kind: "list", title: input.query, items: [],
    emptyText: tr(ctx.locale, "searchCancelled"), actions: [retry] });
  const stop = () => {
    controller.abort();
    if (pending) { pending = false; current = cancelled(); }
  };
  let current: PluginViewContent = progressView(ctx, input, { scannedSections: 0, totalSections: 0, hitCount: 0, contentVersion: null }, async () => {
    stop(); await publish();
  });
  const publish = async () => {
    if (!channel) return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) { channel = undefined; stop(); }
    } catch (error) {
      console.warn("Text Desk range search view publication failed", error);
      if (channel === target) { channel = undefined; stop(); }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted) return;
    try {
      const run = await searchAllBookLocations(
        (pageInput, options) => ctx.domains.library!.queries.books.searchLocations(pageInput, options),
        input,
        { signal: controller.signal, onProgress: async value => {
          if (controller.signal.aborted || !pending) return;
          current = progressView(ctx, input, value, async () => { stop(); await publish(); });
          await publish();
        } },
      );
      if (controller.signal.aborted) return;
      pending = false;
      current = run.status === "cancelled" ? cancelled() : rangeList(ctx, input, run);
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      pending = false;
      current = { kind: "blocks", title: input.query, blocks: [{ kind: "error", code },
        ...(retryable ? [{ kind: "actions" as const, actions: [retry] }] : [])] };
    }
    await publish();
  };
  return { ...current, onClose: stop, live: { subscribe(next) {
    channel = next;
    if (!started) { started = true; void search(); }
    else void publish();
    return { dispose() { if (channel === next) { channel = undefined; stop(); } } };
  } } };
}

export async function rangeDetail(ctx: PluginContext, input: BookRangeQuery): Promise<PluginDetailView> {
  const page = await ctx.domains.library!.queries.books.readRange(input);
  return { kind: "detail", title: tr(ctx.locale, "passage"), content: [
    ...(page.context.before ? [{ kind: "text" as const, text: page.context.before }] : []),
    { kind: "quote", text: page.text, caption: `${page.offset + 1}-${page.offset + page.text.length} / ${page.totalLength}` },
    ...(page.context.after ? [{ kind: "text" as const, text: page.context.after }] : []),
  ], actions: [
    { id: "mark-passage", label: tr(ctx.locale, "highlightMarks"), icon: "text-aa", run: () => markPassages(ctx, [page.range]) },
    { id: "select-passage", label: tr(ctx.locale, "selectPassage"), icon: "text-aa", run: async () => {
      const guard = await ensureReadingSession(ctx, page.range.bookId);
      await ctx.domains.reading!.commands!.selectRange(page.range, guard);
      return { close: true };
    } },
    { id: "open-passage", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading!.commands!.goTo(page.range); return { close: true };
    } },
    ...(page.nextOffset === null ? [] : [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right",
      run: async () => ({ view: await rangeDetail(ctx, { ...input, range: page.range, offset: page.nextOffset! }), navigation: "replace" as const }) }]),
    { id: "search-again", label: tr(ctx.locale, "findPassage"), icon: "magnifying-glass", run: () => ({ view: rangeSearchForm(ctx, page.range.bookId) }) },
  ] };
}
