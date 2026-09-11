import { AppError } from "@read-aware/core";
import type { PluginBookContent } from "@read-aware/plugin-types";
import { normalizePluginBookContent } from "../lib/plugin-book-content";
import { registerContentProviderContribution } from "../state/plugin-store";
import { consumePluginResult } from "./plugin-result";

/** Guard both reader opens and detached Agent/plugin text reads at the provider boundary. */
export function registerPluginContentProvider(
  pluginId: string,
  provider: { id: string; load(key: string): Promise<PluginBookContent> },
  signal: AbortSignal,
) {
  let registration: ReturnType<typeof registerContentProviderContribution> | undefined;
  const check = () => {
    if (signal.aborted || !registration?.isCurrent()) throw new AppError("library/content-unavailable", "Book content provider has retired");
  };
  registration = registerContentProviderContribution({
    key: `${pluginId}:${provider.id}`, pluginId, providerId: String(provider.id),
    load: async key => {
      check();
      return consumePluginResult(provider.load(key), value => { check(); return normalizePluginBookContent(value); });
    },
  });
  return registration;
}
