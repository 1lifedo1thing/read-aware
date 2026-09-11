import { AppError } from "@read-aware/core";

/** Detach JSON output from provider objects; never invoke a remote toJSON callback. */
export function clonePluginJsonResult(value: unknown): unknown {
  try {
    const json = JSON.stringify(structuredClone(value ?? null));
    if (json === undefined) throw new Error("Result is not JSON data");
    return JSON.parse(json);
  } catch (cause) {
    throw new AppError("plugin/invalid-input", "Plugin tool result must be JSON data", { cause });
  }
}
