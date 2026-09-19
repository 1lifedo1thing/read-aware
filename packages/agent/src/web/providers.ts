import { tinyFishProvider } from "./tinyfish";
import { exaProvider } from "./exa";
import { tavilyProvider } from "./tavily";
import { serpApiProvider } from "./serpapi";
import { braveProvider } from "./brave";
import type { WebProvider } from "./types";

/** Add providers here; settings and runtime use the same registry. */
export const WEB_PROVIDERS = { tinyfish: tinyFishProvider, exa: exaProvider, tavily: tavilyProvider, serpapi: serpApiProvider, brave: braveProvider } satisfies Record<string, WebProvider>;
export type WebProviderId = keyof typeof WEB_PROVIDERS;
export function isWebProviderId(value: unknown): value is WebProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WEB_PROVIDERS, value);
}
