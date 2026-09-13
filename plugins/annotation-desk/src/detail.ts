import type { PluginBlock, PluginEditorView, PluginView } from "@read-aware/plugin-types";
import { reviewView } from "./batch";
import { colorForm, commit } from "./mutations";
import { tr } from "./strings";
import type { DeskContext, Refresh } from "./types";

export async function detailView(ctx: DeskContext, id: string, refresh: Refresh): Promise<PluginView> {
  const snapshot = await ctx.domains.annotations.queries.inspect(id);
  if (!snapshot) return { kind: "blocks", blocks: [
    { kind: "text", text: tr(ctx.locale, "missing") },
    { kind: "actions", actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh }] },
  ] };
  const item = snapshot.annotation;
  const book = await ctx.domains.library.queries.books.get(item.bookId);
  const content: PluginBlock[] = [];
  if (item.kind === "note") {
    if (item.quotedText) content.push({ kind: "quote", text: item.quotedText });
    const editor: PluginEditorView = {
      kind: "editor",
      label: tr(ctx.locale, "body"),
      value: item.body,
      revision: snapshot.revision,
      maxLength: 100_000,
      saveLabel: tr(ctx.locale, "save"),
      onSave: async (value, revision) => {
        // The inspected revision remains the business CAS token. A forged or
        // mismatched view revision must fail before a write is attempted.
        if (revision !== snapshot.revision) return { fieldErrors: { editor: tr(ctx.locale, "conflict") } };
        if (value.length > 100_000) return { fieldErrors: { editor: tr(ctx.locale, "bodyLimit") } };
        return commit(ctx, [{ op: "updateNote", annotationId: id, expectedRevision: snapshot.revision, body: value }], "editor", refresh);
      },
      // Cancellation only navigates away; the host discards its local draft
      // before invoking this callback, and no annotation command is issued.
      onCancel: refresh,
    };
    content.push(editor);
  } else {
    content.push({ kind: "quote", text: item.text });
    if (item.kind === "highlight") content.push(colorForm(ctx, [snapshot], refresh));
  }
  return { kind: "detail", title: tr(ctx.locale, item.kind), content,
    metadata: [{ kind: "label", label: tr(ctx.locale, "book"), value: book?.title ?? tr(ctx.locale, "missingBook"), icon: "book-open" }],
    actions: [
      ...(book ? [{ id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
        await ctx.domains.reading.commands.goTo({ bookId: item.bookId, cfi: item.anchor, href: item.chapterHref });
        return { close: true };
      } }] : []),
      { id: "review", label: tr(ctx.locale, "review"), icon: "list-bullets", run: async () => ({ view: await reviewView(ctx, [snapshot], refresh) }) },
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await detailView(ctx, id, refresh), navigation: "replace" }) },
    ] };
}
