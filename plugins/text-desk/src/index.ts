import { inferenceHistory } from "./inference-history";
import type { PluginModule } from "@read-aware/plugin-types";
import { textDesk } from "./views";
import { tr } from "./strings";
import { capturedRangeDetail } from "./range-views";
import { imageControls } from "./image-controls";

export default {
  activate(ctx) {
    if (!ctx.domains.library?.commands || !ctx.domains.reading?.commands) throw Error("Text Desk requires library:write and reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.commands.register({ id: "open", title, icon: "book-open", run: async () => ({ view: await textDesk(ctx) }) });
    ctx.contributions.commands.register({ id: "image-controls", title: `${title}: ${tr(ctx.locale, "imageControls")}`,
      icon: "magnifying-glass", run: async () => ({ view: await imageControls(ctx) }) });
    if (ctx.services.llm) ctx.contributions.commands.register({ id: "inference-history", title: `${title}: ${tr(ctx.locale, "inferenceHistory")}`, icon: "clock-counter-clockwise", run: async () => ({ view: await inferenceHistory(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "book-open", surface: "reader", presentation: "popup", view: () => textDesk(ctx) });
    ctx.contributions.selectionActions.register({ id: "inspect-passage", title: tr(ctx.locale, "inspectPassage"), icon: "magnifying-glass",
      presentation: "dialog", run: async input => ({ view: await capturedRangeDetail(ctx, input.range) }) });
  },
} satisfies PluginModule;
