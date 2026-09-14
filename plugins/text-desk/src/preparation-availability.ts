import type { PluginContext, PluginDetailView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { rebuildForm, startRequest } from "./task-views";

export async function preparationAvailability(ctx: PluginContext, bookId: string, title: string, rebuild = false): Promise<PluginDetailView> {
  const result = await ctx.services.session.operationAvailability({ operation: "library.text.prepare", bookId, rebuild });
  const blocked = result.conditions.some(condition => condition.state === "unavailable" || condition.state === "unconfigured");
  return { kind: "detail", title, content: [
    { kind: "heading", text: tr(ctx.locale, rebuild ? "rebuildPrerequisites" : "preparationPrerequisites") },
    { kind: "text", text: tr(ctx.locale, "preparationPrerequisitesNote") },
    { kind: "keyValue", rows: result.conditions.map(condition => ({
      label: tr(ctx.locale, condition.kind === "provider" ? "sourceProvider" : `availability_${condition.kind}`),
      value: tr(ctx.locale, `availability_${condition.state}`),
    })) },
    ...result.conditions.filter(condition => condition.errorCode).map(condition => ({ kind: "error" as const, code: condition.errorCode! })),
  ], actions: [
    ...(!blocked && ctx.domains.library?.commands ? [{ id: "execute", label: tr(ctx.locale, rebuild ? "rebuild" : "prepare"), icon: "play",
      run: () => rebuild ? { view: rebuildForm(ctx, bookId, title) } : startRequest(ctx, bookId, title) }] : []),
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await preparationAvailability(ctx, bookId, title, rebuild), navigation: "replace" }) },
    { id: "switch", label: tr(ctx.locale, rebuild ? "preparationPrerequisites" : "rebuildPrerequisites"), run: async () => ({ view: await preparationAvailability(ctx, bookId, title, !rebuild), navigation: "replace" }) },
  ] };
}
