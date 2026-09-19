import { tinyFishProvider } from "./tinyfish";
import type { WebProvider } from "./types";

/** Add providers here; settings and runtime use the same registry. */
export const WEB_PROVIDERS = { tinyfish: tinyFishProvider } satisfies Record<string, WebProvider>;
export type WebProviderId = keyof typeof WEB_PROVIDERS;
export function isWebProviderId(value: unknown): value is WebProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WEB_PROVIDERS, value);
}
