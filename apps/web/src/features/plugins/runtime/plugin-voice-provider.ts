import { AppError } from "@read-aware/core";
import type { PluginDisposable, PluginVoiceProvider } from "@read-aware/plugin-types";
import { onAppEvent } from "../../../platform/app-events";
import { createLogger } from "../../../platform/logger";
import { contributionKey, type RegisteredVoiceProvider } from "../lib/plugin-types";
import { normalizePluginVoices } from "../lib/plugin-voices";
import { commitContributionReplacement } from "../state/contribution-activation";
import { registerVoiceProviderContribution, updateVoiceProviderVoices } from "../state/plugin-store";
import { releasePluginCallbacks } from "./plugin-callback-wire";
import type { PluginLifecycleController } from "./plugin-lifecycle";

const log = createLogger("plugin-voices");

/** One registration owns one serial voice query and the newest requested settings revision. */
export function registerPluginVoiceProvider(
  provider: PluginVoiceProvider,
  brand: { pluginId: string; pluginName: string },
  lifecycle: PluginLifecycleController,
): PluginDisposable {
  const signal = lifecycle.signal;
  const key = contributionKey(brand.pluginId, provider.id);
  const releaseResult = (value: unknown) => {
    try { releasePluginCallbacks(value); }
    catch (error) { lifecycle.trackCleanup(Promise.reject(error)); }
  };
  let registered: RegisteredVoiceProvider = {
    ...provider, ...brand, key, voices: [],
    async synthesize(input) {
      if (!committed || !current()) throw new AppError("plugin/unavailable", "Voice provider is not active");
      const revision = requested;
      const bytes = await provider.synthesize(input);
      try {
        if (!current() || revision !== requested) throw new AppError("plugin/unavailable", "Voice provider changed during synthesis");
        if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Uint8Array)) {
          throw new AppError("plugin/invalid-input", "Voice provider did not return encoded audio bytes");
        }
        return bytes;
      } finally { releaseResult(bytes); }
    },
  };
  let disposed = false, committed = false, running = false;
  let requested = 0, completed = -1;
  const registration = registerVoiceProviderContribution(registered);
  const current = () => !disposed && !signal.aborted && registration.isCurrent();

  const refresh = async () => {
    if (!committed || running || !current()) return;
    running = true;
    try {
      while (current() && completed !== requested) {
        const revision = requested;
        try {
          const voices = await provider.listVoices();
          try {
            if (current() && revision === requested) {
              const replacement = updateVoiceProviderVoices(key, normalizePluginVoices(voices), registered);
              if (replacement) registered = replacement;
            }
          } finally { releaseResult(voices); }
        } catch (error) {
          // Keep the last valid voices on read failure; a later settings change retries.
          if (current()) log.warn(`listVoices from "${brand.pluginId}" failed`, error);
        }
        completed = revision;
      }
    } finally { running = false; }
  };
  const offStorage = onAppEvent("plugin-storage-changed", ({ pluginId }) => {
    if (pluginId !== brand.pluginId || !current()) return;
    requested++;
    void refresh();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", cancel);
    offStorage();
    registration.dispose();
  };
  const cancel = () => {
    try { dispose(); } catch (error) { lifecycle.trackCleanup(Promise.reject(error)); }
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  commitContributionReplacement(() => {
    committed = true;
    // The factory batch must finish publishing before a provider can run code.
    queueMicrotask(() => { void refresh(); });
  });
  return { dispose };
}
