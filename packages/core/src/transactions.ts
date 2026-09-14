import { AppError } from "./errors";
import { clonePluginServiceData } from "./plugin-services";
import type { SettingChange } from "./settings";

/** Only local semantic mutations can join a transaction. External I/O, import,
 * deletion of book files and arbitrary plugin callbacks are not atomic verbs. */
export type AtomicOperation =
  | { kind: "book.metadata"; bookId: string; patch: { title?: string; author?: string } }
  | { kind: "settings"; changes: SettingChange[] }
  | { kind: "document.put"; collection: string; id: string; bookId: string | null; data: unknown; anchor?: string }
  | { kind: "document.delete"; collection: string; id: string };
export type AtomicPreview = { id: string; expiresAt: string; operations: AtomicOperation[]; before: unknown[]; undoOf?: string };
export type AtomicReceipt = { id: string; committed: true; undoOf?: string };
export interface TransactionsPort {
  preview(operations: AtomicOperation[], signal?: AbortSignal): Promise<AtomicPreview>;
  commit(previewId: string, signal?: AbortSignal): Promise<AtomicReceipt>;
  previewUndo(receiptId: string, signal?: AbortSignal): Promise<AtomicPreview>;
  receipt(receiptId: string, signal?: AbortSignal): Promise<AtomicReceipt | null>;
}
const invalid = (): never => { throw new AppError("transaction/invalid-operation", "Invalid or non-transactional operation"); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 1024): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);
const fields = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

export function normalizeAtomicOperations(input: unknown): AtomicOperation[] {
  const values = clonePluginServiceData(input);
  if (!Array.isArray(values) || !values.length || values.length > 100) return invalid();
  for (const value of values) {
    if (!record(value)) return invalid();
    switch (value.kind) {
      case "book.metadata":
        if (!fields(value, ["kind", "bookId", "patch"]) || !text(value.bookId) || !record(value.patch)
          || !fields(value.patch, ["title", "author"]) || !Object.keys(value.patch).length
          || value.patch.title !== undefined && !text(value.patch.title, 2000)
          || value.patch.author !== undefined && (typeof value.patch.author !== "string" || value.patch.author.length > 2000)) return invalid();
        break;
      case "settings":
        if (!fields(value, ["kind", "changes"]) || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 100) return invalid();
        // Catalog validates values after actor authorization.
        if (value.changes.some(change => !record(change) || !fields(change, ["path", "value", "target"]) || !text(change.path, 256) || !Object.prototype.hasOwnProperty.call(change, "value"))) return invalid();
        for (const change of value.changes as Record<string, unknown>[]) {
          if (change.target === undefined) continue;
          const target = change.target;
          if (!record(target) || !["global", "book", "all-books"].includes(String(target.kind))
            || !fields(target, target.kind === "book" ? ["kind", "bookId"] : ["kind"])
            || target.kind === "book" && !text(target.bookId)) return invalid();
        }
        break;
      case "document.put":
      case "document.delete":
        if (!fields(value, value.kind === "document.put" ? ["kind", "collection", "id", "bookId", "data", "anchor"] : ["kind", "collection", "id"])
          || !text(value.collection, 64) || !/^[a-z0-9][a-z0-9_-]*$/.test(value.collection) || !text(value.id)) return invalid();
        if (value.kind === "document.put" && (value.bookId !== null && !text(value.bookId)
          || !Object.prototype.hasOwnProperty.call(value, "data") || value.anchor !== undefined && !text(value.anchor, 16384))) return invalid();
        break;
      default: return invalid();
    }
  }
  return values as AtomicOperation[];
}
