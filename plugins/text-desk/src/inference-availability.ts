import type { PluginContext, PluginDetailView } from "@read-aware/plugin-types";
import { tr } from "./strings";

/** The same smart/image prerequisites used by Text Desk's image explanation. */
export async function inferenceAvailability(ctx: PluginContext): Promise<PluginDetailView> {
  const result = await ctx.services.session.operationAvailability({ operation: "llm.infer", model: "smart", images: true });
  return { kind: "detail", title: tr(ctx.locale, "inferenceAvailability"), content: [
    { kind: "text", text: tr(ctx.locale, "availabilityNote") },
    { kind: "keyValue", rows: result.conditions.map(condition => ({
      label: tr(ctx.locale, `availability_${condition.kind}`), value: tr(ctx.locale, `availability_${condition.state}`),
    })) },
    ...result.conditions.filter(condition => condition.errorCode).map(condition => ({ kind: "error" as const, code: condition.errorCode! })),
  ], actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
    run: async () => ({ view: await inferenceAvailability(ctx), navigation: "replace" }) }] };
}
