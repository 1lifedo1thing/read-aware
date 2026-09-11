import { errorCode } from "@read-aware/core";
import { pluginNetworkError } from "../features/plugins/runtime/plugin-network-error";

export const NETWORK_RETRY_POLICY = Object.freeze({ maxRetries: 2, baseDelayMs: 500, maxDelayMs: 30_000,
  statuses: [429, 502, 503, 504] as readonly number[] });

export function networkRetryDelay(header: string | null, retry: number, now = Date.now()): number | null {
  const fallback = NETWORK_RETRY_POLICY.baseDelayMs * 2 ** retry;
  if (!header) return fallback;
  const seconds = /^\d+$/.test(header.trim()) ? Number(header.trim()) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(delay)) return fallback;
  // A longer server cooldown is not permission to retry earlier than requested.
  return delay > NETWORK_RETRY_POLICY.maxDelayMs ? null : Math.max(fallback, delay);
}

export function waitForNetworkRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One retry allowance across all redirect hops. Never retries body reads or unsafe methods. */
export class NetworkRetry {
  private retries = 0;
  constructor(private readonly signal: AbortSignal, private readonly report: (reason: unknown) => void,
    private readonly wait = waitForNetworkRetry) {}
  async run(request: () => Promise<Response>, safe: boolean): Promise<Response> {
    for (;;) {
      this.signal.throwIfAborted();
      let response: Response | undefined, reason: unknown;
      try { response = await request(); }
      catch (error) { reason = pluginNetworkError(error); }
      if (this.signal.aborted) {
        if (response) await this.discard(response);
        this.signal.throwIfAborted();
      }
      const retryable = response ? NETWORK_RETRY_POLICY.statuses.includes(response.status) : errorCode(reason) === "plugin/network-failed";
      if (!safe || !retryable || this.retries >= NETWORK_RETRY_POLICY.maxRetries) {
        if (response) return response;
        throw reason;
      }
      const delay = networkRetryDelay(response?.headers.get("retry-after") ?? null, this.retries);
      if (delay === null) return response!;
      if (response) await this.discard(response);
      this.report(response ? { status: response.status, retry: this.retries + 1, delayMs: delay } : reason);
      this.retries++;
      await this.wait(delay, this.signal);
    }
  }
  private async discard(response: Response) {
    try { await response.body?.cancel(); }
    catch (error) { this.report(error); }
  }
}
