import { hostShutdown } from "../services/shutdown";
import { registerPersistenceShutdownOwners } from "./persistence-shutdown";
import { readingTraces } from "../features/reader/lib/reading-trace-runtime";
import { shutdownPlugins } from "../features/plugins/runtime/plugin-host";

/** The product's durable owners, in the order a close must respect: end the reading session
 * and quiesce plugins, drain KV/credentials, then await their generated events. */
export function registerShutdownOwners(): () => void {
  const disposers = [
    hostShutdown.register("reading-traces", "settle", () => readingTraces.settle()),
    hostShutdown.register("plugins", "settle", signal => shutdownPlugins(signal)),
    registerPersistenceShutdownOwners(hostShutdown),
  ];
  return () => { for (const dispose of disposers) dispose(); };
}
