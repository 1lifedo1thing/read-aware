import { createLogger } from "../../../platform/logger";
import { releasePluginCallbacks } from "./plugin-callback-wire";

const log = createLogger("plugin-results");

/** Data-only consumers must project/copy their result before releasing its callback graph. */
export async function consumePluginResult<T, R>(
  pending: T | Promise<T>,
  consume: (value: T) => R | Promise<R>,
): Promise<R> {
  const value = await pending;
  try { return await consume(value); }
  finally {
    try { releasePluginCallbacks(value); }
    catch (error) { log.warn("Plugin result callback cleanup failed", error); }
  }
}
