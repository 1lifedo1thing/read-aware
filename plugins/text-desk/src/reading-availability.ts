import type { PluginContext, PluginDetailView } from "@read-aware/plugin-types";
import { tr } from "./strings";
type OperationCondition = Awaited<ReturnType<PluginContext["services"]["session"]["operationAvailability"]>>["conditions"][number];

/** Refresh and actions retain the book/session the reader inspected. */
export async function readingAvailability(ctx: PluginContext, target?: { bookId: string; sessionId: string }): Promise<PluginDetailView> {
  const reading = ctx.domains.reading;
  if (!reading) throw Error("Text Desk requires reading access");
  const current = target ? null : await reading.queries.session();
  const guard = target ?? (current?.bookId && current.sessionId ? { bookId: current.bookId, sessionId: current.sessionId } : null);
  if (!guard) return { kind: "detail", title: tr(ctx.locale, "readingAvailability"), content: [{ kind: "error", code: "reader/unavailable" }] };
  const queries = [
    { operation: "reading.mode.configure" as const, ...guard, active: true },
    { operation: "reading.playback" as const, ...guard, action: "start" as const },
    { operation: "reading.playback" as const, ...guard, action: "stop" as const },
  ];
  const results = await Promise.all(queries.map(query => ctx.services.session.operationAvailability(query)));
  const names = ["enableReadingMode", "startReadingAloud", "stopReadingAloud"] as const;
  const conditionLabel = (reason: string, kind: OperationCondition["kind"]) => reason === "mode-inactive" ? "readingModeCondition"
    : reason === "no-unit" || kind === "input" ? "readingUnitCondition"
    : kind === "provider" ? "readingProviderCondition" : `availability_${kind}` as const;
  return { kind: "detail", title: tr(ctx.locale, "readingAvailability"), content: [
    { kind: "text", text: tr(ctx.locale, "readingAvailabilityNote") },
    ...results.flatMap((result, i) => [
      { kind: "heading" as const, text: tr(ctx.locale, names[i]!) },
      { kind: "keyValue" as const, rows: result.conditions.map(condition => ({
        label: tr(ctx.locale, conditionLabel(condition.reason, condition.kind)), value: tr(ctx.locale, `availability_${condition.state}`),
      })) },
      ...result.conditions.filter(condition => condition.errorCode).map(condition => ({ kind: "error" as const, code: condition.errorCode! })),
    ]),
  ], actions: [
    ...results.flatMap((result, i) => !reading.commands || result.conditions.some(condition => condition.state === "unavailable" || condition.state === "unconfigured") ? [] : [{
      id: names[i]!, label: tr(ctx.locale, names[i]!), run: async () => {
        if (i === 0) await reading.commands!.configureMode({ active: true }, guard);
        else await reading.commands!.controlPlayback(i === 1 ? "start" : "stop", guard);
        return { view: await readingAvailability(ctx, guard), navigation: "replace" as const };
      },
    }]),
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await readingAvailability(ctx, guard), navigation: "replace" }) },
  ] };
}
