import { AppError } from "@read-aware/core";

export const PLUGIN_WIRE_LIMITS = Object.freeze({ bytes: 80 * 1024 * 1024, entries: 1_000_000, depth: 128,
  callbacksPerMessage: 100_000, retainedCallbacks: 200_000, disposables: 4096 });

/** Admission accounting, not a bound on structured-clone or decoder peak memory. */
export function assertPluginWireBudget(value: unknown, limits: { bytes: number; entries: number; depth: number } = PLUGIN_WIRE_LIMITS,
  account?: (usage: { bytes: number; entries: number }) => void): void {
  let bytes = 0, entries = 0;
  const seen = new Set<object>();
  const charge = (amount: number) => {
    bytes += amount;
    if (bytes > limits.bytes) throw new AppError("plugin/quota-exceeded", "Plugin message exceeds its byte budget");
  };
  const visit = (item: unknown, depth: number): void => {
    if (++entries > limits.entries || depth > limits.depth) throw new AppError("plugin/quota-exceeded", "Plugin message graph exceeds its budget");
    charge(8);
    if (typeof item === "string") { charge(item.length * 2); return; }
    if (typeof item === "bigint") { charge(item.toString(16).length); return; }
    if (item === null || typeof item !== "object") {
      if (typeof item === "function" || typeof item === "symbol") throw new AppError("plugin/invalid-input", "Non-cloneable plugin message");
      return;
    }
    if (seen.has(item)) return;
    seen.add(item);
    if (item instanceof ArrayBuffer) { charge(item.byteLength); return; }
    if (ArrayBuffer.isView(item)) { visit(item.buffer, depth + 1); return; }
    if (typeof Blob !== "undefined" && item instanceof Blob) {
      charge(item.size + item.type.length * 2);
      if (typeof File !== "undefined" && item instanceof File) charge(item.name.length * 2);
      return;
    }
    if (item instanceof Date) return;
    if (item instanceof RegExp) { charge((item.source.length + item.flags.length) * 2); return; }
    if (item instanceof Error) {
      visit(item.name, depth + 1); visit(item.message, depth + 1); visit(item.stack, depth + 1);
      visit(item.cause, depth + 1);
      if (item instanceof AggregateError) visit(item.errors, depth + 1);
      return;
    }
    if (item instanceof Map) {
      for (const [key, entry] of item) { visit(key, depth + 1); visit(entry, depth + 1); }
      return;
    }
    if (item instanceof Set) { for (const entry of item) visit(entry, depth + 1); return; }
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) throw new AppError("plugin/invalid-input", "Unsupported plugin message object");
    if (Array.isArray(item) && item.length > limits.entries) throw new AppError("plugin/quota-exceeded", "Plugin message array exceeds its budget");
    // Do not allocate Object.entries for an untrusted graph or read inherited fields.
    for (const key in item) if (Object.prototype.hasOwnProperty.call(item, key)) {
      charge(key.length * 2);
      visit((item as Record<string, unknown>)[key], depth + 1);
    }
  };
  // Failed per-message admission still consumed traversal work and transport bytes.
  try { visit(value, 0); }
  finally { account?.({ bytes, entries }); }
}
