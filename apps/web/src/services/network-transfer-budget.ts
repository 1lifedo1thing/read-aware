import { AppError } from "@read-aware/core";

export const NETWORK_TRANSFER_LIMITS = Object.freeze({
  windowMs: 60_000, maxOwnerRequests: 120, maxHostRequests: 480,
  maxOwnerBytes: 2 * 1024 ** 3, maxHostBytes: 8 * 1024 ** 3,
  maxOwners: 1024,
});
type Counter = { at: number; requests: number; bytes: number };

/** Fixed windows start on first use, not calendar boundaries; owner debt survives reactivation. */
export class NetworkTransferBudget {
  private readonly owners = new Map<string, Counter>();
  private host: Counter | undefined;
  constructor(private readonly limits: { [K in keyof typeof NETWORK_TRANSFER_LIMITS]: number } = NETWORK_TRANSFER_LIMITS,
    private readonly now = () => performance.now()) {}
  charge(owner: string, requests: number, bytes: number, received = false) {
    if (!owner || !Number.isSafeInteger(requests) || requests < 0 || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new AppError("plugin/invalid-input", "Invalid network accounting");
    }
    const now = this.now();
    if (!this.host || now - this.host.at >= this.limits.windowMs) this.host = { at: now, requests: 0, bytes: 0 };
    let counter = this.owners.get(owner);
    if (!counter || now - counter.at >= this.limits.windowMs) {
      for (const [key, value] of this.owners) if (now - value.at >= this.limits.windowMs) this.owners.delete(key);
      if (!this.owners.has(owner) && this.owners.size >= this.limits.maxOwners) throw new AppError("plugin/network-busy", "Network accounting owner capacity reached", { retryable: true });
      counter = { at: now, requests: 0, bytes: 0 }; this.owners.set(owner, counter);
    }
    if (counter.requests + requests > this.limits.maxOwnerRequests || this.host.requests + requests > this.limits.maxHostRequests
      || counter.bytes + bytes > this.limits.maxOwnerBytes || this.host.bytes + bytes > this.limits.maxHostBytes) {
      if (received) {
        // Bytes already read cannot be refunded by rejecting their delivery.
        counter.bytes = Math.min(counter.bytes + bytes, this.limits.maxOwnerBytes + 1);
        this.host.bytes = Math.min(this.host.bytes + bytes, this.limits.maxHostBytes + 1);
      }
      throw new AppError("plugin/network-rate-limited", "Cumulative network request or byte budget exceeded", { retryable: true });
    }
    counter.requests += requests; counter.bytes += bytes;
    this.host.requests += requests; this.host.bytes += bytes;
  }
}

export const networkTransferBudget = new NetworkTransferBudget();
