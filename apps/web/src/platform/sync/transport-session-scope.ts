import type { PluginSyncTransportSession } from "@read-aware/plugin-types";
import { createLogger } from "../logger";

const log = createLogger("sync-session");

/** Temporary connection rituals close before publishing a durable binding. */
export async function withTransportSession<T>(session: PluginSyncTransportSession, run: () => Promise<T>): Promise<T> {
  let result: T;
  try { result = await run(); }
  catch (error) {
    try { await session.close(); }
    catch (closeError) {
      // Preserve the actionable operation error, e.g. the wrong passphrase.
      log.warn("Transport cleanup also failed after connection failure", closeError);
    }
    throw error;
  }
  // After a successful ritual, a failed close is the operation's failure.
  await session.close();
  return result;
}
