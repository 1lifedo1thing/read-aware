import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AgentFetch } from "@read-aware/agent";

/** Native HTTP transport for product traffic that must not depend on WebView CORS.
 * plugin-http does not forward RequestInit.redirect to reqwest. Translate it so
 * provider credentials and retrieved image requests cannot follow redirects. */
export const appHttpFetch: AgentFetch = async (input, init) => {
  const response = await tauriFetch(input, {
    ...init,
    ...(init?.redirect === "error" || init?.redirect === "manual" ? { maxRedirections: 0 } : {}),
  });
  if (init?.redirect === "error" && response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new TypeError("Redirects are not allowed for this request");
  }
  return response;
};
