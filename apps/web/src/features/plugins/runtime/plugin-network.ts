import { AppError } from "@read-aware/core";
import type { PluginHostServices, PluginNetworkAccess } from "@read-aware/plugin-types";
import type { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { authorizePluginNetworkUrl, parsePluginNetworkAccess } from "../lib/plugin-network-policy";
import { flattenPluginRequest, MAX_PLUGIN_NETWORK_BODY_BYTES } from "./plugin-network-wire";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { PLUGIN_NETWORK_LIMITS, PluginNetworkRequests } from "./plugin-network-requests";
import { NETWORK_TRANSFER_LIMITS, networkTransferBudget } from "../../../services/network-transfer-budget";
import { NETWORK_RETRY_POLICY, NetworkRetry } from "../../../services/network-retry";
import { createLogger } from "../../../platform/logger";

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const log = createLogger("plugin-network");
function allowRetry(options?: { retry?: "none" | "safe" }): boolean {
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)
    || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    || Object.keys(options).some(key => key !== "retry") || (options.retry !== undefined && options.retry !== "none" && options.retry !== "safe"))) {
    throw new AppError("plugin/invalid-input", "Invalid network retry options");
  }
  return options?.retry === "safe";
}

export function createPluginNetworkService(
  access: PluginNetworkAccess | undefined,
  lifecycle: PluginLifecycleController,
  transport: typeof nativeFetch,
  owner: string,
): NonNullable<PluginHostServices["network"]> {
  const { origins } = parsePluginNetworkAccess(access);
  const requests = new PluginNetworkRequests(fetch, lifecycle.signal, pending => lifecycle.trackCleanup(pending), PLUGIN_NETWORK_LIMITS,
    bytes => networkTransferBudget.charge(owner, 0, bytes, true));

  async function fetch(input: string | URL | Request, init?: RequestInit, retry = false): Promise<Response> {
    // Flattening also strips native-only proxy/TLS options from untrusted init.
    const initial = new Request(input, init);
    let url = authorizePluginNetworkUrl(origins, initial.url);
    const request = await flattenPluginRequest(initial);
    let method = request.init.method;
    let body = request.init.body;
    const headers = new Headers(request.init.headers);
    const retries = new NetworkRetry(request.signal, reason => log.warn("Retrying plugin network request", reason));
    // Original unsafe requests do not become retryable merely through a 303 redirect.
    const safe = retry && (method === "GET" || method === "HEAD") && body == null;
    headers.delete("host");
    headers.delete("content-length");
    for (let redirects = 0; ; redirects++) {
      lifecycle.assertActive("services.network.fetch");
      request.signal.throwIfAborted();
      // Native auto-follow would evade per-hop grants. The installed transport
      // maps maxRedirections:0 to reqwest Policy::none(), exposing each 3xx.
      const response = await retries.run(() => {
        lifecycle.assertActive("services.network.fetch");
        authorizePluginNetworkUrl(origins, url.href);
        networkTransferBudget.charge(owner, 1, body instanceof ArrayBuffer ? body.byteLength : 0);
        return transport(url.href, {
          ...request.init, method, body, headers, signal: request.signal,
          maxRedirections: 0,
        });
      }, safe);
      try {
        lifecycle.assertActive("services.network.fetch");
        request.signal.throwIfAborted();
        Object.defineProperty(response, "redirected", { value: redirects > 0 });
        if (!REDIRECT_STATUSES.has(response.status) || request.init.redirect === "manual") {
          return response;
        }
        if (request.init.redirect === "error") throw new AppError("plugin/network-redirect", "Redirect mode forbids following this response");
        const location = response.headers.get("location");
        if (location === null) return response;
        if (redirects === MAX_REDIRECTS) throw new AppError("plugin/network-redirect", "Redirect limit exceeded");
        let destination: URL;
        try { destination = new URL(location, url); }
        catch { throw new AppError("plugin/network-redirect", "Invalid redirect destination"); }
        authorizePluginNetworkUrl(origins, destination.href);
        if (url.protocol === "https:" && destination.protocol !== "https:") {
          throw new AppError("plugin/network-denied", "HTTPS downgrade redirects are not allowed");
        }
        if (destination.origin !== url.origin) {
          for (const name of ["authorization", "proxy-authorization", "cookie", "referer"]) headers.delete(name);
        }
        if (((response.status === 301 || response.status === 302) && method === "POST") ||
            (response.status === 303 && method !== "GET" && method !== "HEAD")) {
          method = "GET";
          body = undefined;
          for (const name of ["content-encoding", "content-language", "content-location", "content-type"]) headers.delete(name);
        }
        url = destination;
      } catch (error) {
        await discardResponse(response);
        throw error;
      }
      await discardResponse(response);
    }
  }

  return {
    policy: async () => {
      lifecycle.assertActive("services.network.policy");
      return { origins: [...origins], maxRedirects: MAX_REDIRECTS, maxBodyBytes: MAX_PLUGIN_NETWORK_BODY_BYTES, ...PLUGIN_NETWORK_LIMITS,
        cumulative: { ...NETWORK_TRANSFER_LIMITS }, retry: { ...NETWORK_RETRY_POLICY, statuses: [...NETWORK_RETRY_POLICY.statuses] } };
    },
    fetch: (input, init, options) => {
      lifecycle.assertActive("services.network.fetch");
      return requests.fetch(input, init, allowRetry(options));
    },
    openStream: (input, init, options) => {
      lifecycle.assertActive("services.network.openStream");
      return requests.open(input, init, undefined, allowRetry(options));
    },
    readStream: (id, offset, maxBytes) => {
      lifecycle.assertActive("services.network.readStream");
      return requests.read(id, offset, maxBytes);
    },
    closeStream: id => {
      lifecycle.assertActive("services.network.closeStream");
      return requests.close(id);
    },
  };
}

async function discardResponse(response: Response): Promise<void> {
  try { await response.body?.cancel(); }
  catch { /* Best-effort release of a redirect/error body; preserve the primary result. */ }
}
