import type { PluginContext } from "@read-aware/plugin-types";
import { consumePluginResult } from "./plugin-result";

type MethodPaths<T> = T extends object ? {
  [K in keyof T & string]: NonNullable<T[K]> extends (...args: never[]) => unknown ? K
    : NonNullable<T[K]> extends object ? `${K}.${MethodPaths<NonNullable<T[K]>>}` : never
}[keyof T & string] : never;

type NotificationPaths<T> = T extends object ? {
  [K in keyof T & string]: NonNullable<T[K]> extends (...args: infer A) => unknown
    ? Extract<A[number], (...args: never[]) => unknown> extends never ? never : K
    : NonNullable<T[K]> extends object ? `${K}.${NotificationPaths<NonNullable<T[K]>>}` : never
}[keyof T & string] : never;

/** These APIs await callback completion but consume no returned value.
 * Keep exact paths: a view action, provider or stream session can return owned callbacks. */
export const PLUGIN_CALLBACK_RESULT_SINKS = [
  "domains.library.events.subscribe",
  "domains.library.events.observeTextTask",
  "domains.library.events.observeEnrichment",
  "domains.library.events.observeContentState",
  "domains.library.events.observeInvalidation",
  "domains.reading.events.subscribe",
  "domains.reading.events.observeSession",
  "domains.reading.events.observeEmphasis",
  "domains.reading.events.observeTime",
  "domains.annotations.events.subscribe",
  "domains.annotations.events.observe",
  "domains.conversations.events.subscribe",
  "domains.conversations.events.observeRuntime",
  "domains.conversations.events.observeInvalidation",
  "domains.memory.events.observe",
  "domains.settings.queries.observe",
  "domains.settings.events.subscribe",
  "services.storage.onChange",
  "services.storage.observeDocuments",
  "services.ui.window.observe",
  "services.ui.commands.observe",
  "services.ui.workspace.observe",
  "services.ui.reader.observe",
  "services.ui.reader.image.observe",
  "services.ui.showToast",
  "services.schedules.bind",
  "services.schedules.observe",
  "services.plugins.observe",
  "services.plugins.observeContributions",
  "services.maintenance.observe",
  "services.sync.observe",
  "services.session.observeEnvironment",
  "services.llm.ask",
  "services.llm.askDetailed",
] as const satisfies readonly MethodPaths<Pick<PluginContext, "domains" | "services">>[];

type AssertComplete<T extends never> = T;
/** Current service/domain callback parameters are notifications. New callbacks
 * must receive an explicit result policy; nested toast/LLM callbacks are listed above. */
export type PluginNotificationResultCoverage = AssertComplete<Exclude<
  NotificationPaths<Pick<PluginContext, "domains" | "services">>, typeof PLUGIN_CALLBACK_RESULT_SINKS[number]
>>;

const sinks: ReadonlySet<string> = new Set(PLUGIN_CALLBACK_RESULT_SINKS);
type Invoke = (handle: string, args: unknown[]) => Promise<unknown>;

/** Select before decoding, so retained callbacks do not capture the whole RPC message. */
export function pluginCallbackInvoker(method: string, invoke: Invoke): Invoke {
  return sinks.has(method)
    ? (handle, args) => consumePluginResult(invoke(handle, args), () => undefined)
    : invoke;
}
