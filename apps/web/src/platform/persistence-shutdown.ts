import type { ShutdownCoordinator } from "../services/shutdown";
import { flushLocalKV } from "./local-store";
import { flushSecretWrites } from "./secret-store";
import { durableWrites } from "./write-settlement";

/** Queue commit observers enqueue roaming events. Drain those receipts only
 * after both queues finish, including when a queue reports a failed write. */
export function registerPersistenceShutdownOwners(coordinator: ShutdownCoordinator): () => void {
  const disposers = [
    coordinator.register("local-kv", "persist", () => flushLocalKV()),
    coordinator.register("credentials", "persist", () => flushSecretWrites()),
    coordinator.register("domain-events", "receipts", signal => durableWrites.settle(signal)),
  ];
  return () => { for (const dispose of disposers) dispose(); };
}
