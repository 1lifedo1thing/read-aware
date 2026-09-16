import type { PluginModule } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { assertCapabilities, bookGrant } from "./types";
import { annotationsView } from "./views";
import { selectionCreationView } from "./creation";

const plugin: PluginModule = {
  activate(ctx) {
    assertCapabilities(ctx);
    const title = tr(ctx.locale, "title");
    for (const kind of ["note", "highlight"] as const) ctx.contributions.selectionActions.register({
      id: `create-${kind}`, title: tr(ctx.locale, kind === "note" ? "newNote" : "newHighlight"),
      icon: kind === "note" ? "note-pencil" : "highlighter", presentation: "dialog",
      run: input => {
        const bookId = input.book.id;
        return { view: selectionCreationView(ctx, input, kind, async () => ({
          view: await annotationsView(ctx, { bookId, previous: [] }), navigation: "reset",
        })) };
      },
    });
    // A shelf action is a whole-library entry. Keep it out of restricted
    // activations; their reader/command entries resolve to their granted book.
    if (bookGrant(ctx).mode === "all") ctx.contributions.headerActions.register({ id: "shelf", title, icon: "note-pencil", surface: "shelf", presentation: "page",
      view: () => annotationsView(ctx) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "note-pencil", surface: "reader", presentation: "popup",
      view: input => annotationsView(ctx, { bookId: input.book?.id, previous: [] }) });
    ctx.contributions.commands.register({ id: "open", title, icon: "note-pencil", keywords: "annotation note highlight organize export",
      run: async () => {
        const grant = bookGrant(ctx);
        if (grant.mode === "book") return { view: await annotationsView(ctx, { bookId: grant.bookId, previous: [] }) };
        const session = await ctx.domains.reading.queries.session();
        return { view: await annotationsView(ctx, { bookId: session.bookId ?? undefined, previous: [] }) };
      } });
  },
};
export default plugin;
