import { AppError, type IdentityConsolidationSnapshot } from "@read-aware/core";
import { identityBytes, type IdentityDigest, type IdentityInput } from "./identity-input";

// Journal node v1 and checkpoint v2 both depend on these deterministic sizes.
export const SOURCE_BYTES = 8_000;
export const DIGEST_BYTES = 3_500;
export const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid identity work digest"); };
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function digest(value: unknown, eligible: Set<string>): IdentityDigest {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.summary !== "string" || !Array.isArray(value.memoryIds)
    || value.memoryIds.some(id => typeof id !== "string" || !eligible.has(id)) || new Set(value.memoryIds).size !== value.memoryIds.length
    || Boolean(value.summary.trim()) !== Boolean(value.memoryIds.length) || identityBytes(JSON.stringify(value)) > DIGEST_BYTES) return invalid();
  return { summary: value.summary, memoryIds: [...value.memoryIds] as string[] };
}

export type SourceCursor = { sourceIndex: number; start: number };
type Fragment = IdentityInput["memories"][number] & { fragment: { start: number; end: number; total: number } };
export type BatchState = { version: 2; cursor: SourceCursor; levels: (IdentityDigest | null)[];
  current: { digest: IdentityDigest; level: number } | null; root: IdentityDigest | null; foldLevel: number | null };
export const initialBatchState = (): BatchState => ({ version: 2, cursor: { sourceIndex: 0, start: 0 }, levels: [], current: null, root: null, foldLevel: null });
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const index = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function readBatchState(json: string | null, snapshot: IdentityConsolidationSnapshot): BatchState {
  if (json === null) return initialBatchState();
  const value: unknown = JSON.parse(json);
  if (!record(value) || !exact(value, ["version", "cursor", "levels", "current", "root", "foldLevel"]) || value.version !== 2
    || !record(value.cursor) || !exact(value.cursor, ["sourceIndex", "start"])
    || !index(value.cursor.sourceIndex) || value.cursor.sourceIndex > snapshot.sources.length || !index(value.cursor.start)
    || !Array.isArray(value.levels) || value.levels.length > 53) return invalid();
  const source = snapshot.sources[value.cursor.sourceIndex]?.memory.content;
  if (source === undefined ? value.cursor.start !== 0 : value.cursor.start > source.length
    || value.cursor.start > 0 && value.cursor.start < source.length && /[\uDC00-\uDFFF]/.test(source[value.cursor.start]!)) return invalid();
  const eligible = new Set(snapshot.sources.map(source => source.memory.id));
  const levels = value.levels.map(item => item === null ? null : digest(item, eligible));
  let current: BatchState["current"] = null;
  if (value.current !== null) {
    if (!record(value.current) || !exact(value.current, ["digest", "level"]) || !index(value.current.level) || value.current.level >= 53) return invalid();
    current = { digest: digest(value.current.digest, eligible), level: value.current.level };
  }
  if (value.foldLevel !== null && (!Number.isInteger(value.foldLevel) || (value.foldLevel as number) < -1
    || (value.foldLevel as number) >= levels.length || current !== null || value.cursor.sourceIndex !== snapshot.sources.length)) return invalid();
  if (value.root !== null && value.foldLevel === null) return invalid();
  return { version: 2, cursor: { sourceIndex: value.cursor.sourceIndex, start: value.cursor.start }, levels, current,
    root: value.root === null ? null : digest(value.root, eligible), foldLevel: value.foldLevel as number | null };
}

/** Resume at the first unread code unit, preserving the original leaf grouping. */
export function nextIdentityLeaf(snapshot: IdentityConsolidationSnapshot, cursor: SourceCursor): { memories: Fragment[]; cursor: SourceCursor } | null {
  const page: Fragment[] = [];
  let { sourceIndex, start } = cursor;
  while (sourceIndex < snapshot.sources.length) {
    const memory = snapshot.sources[sourceIndex]!.memory;
    const base = { id: memory.id, kind: memory.kind, scope: memory.scope, evidenceCount: memory.evidenceCount,
      pinned: memory.pinned ?? false, createdAt: memory.createdAt, updatedAt: memory.updatedAt };
    const fragment = (end: number): Fragment => ({ ...base, content: memory.content.slice(start, end), fragment: { start, end, total: memory.content.length } });
    let low = start, high = Math.min(memory.content.length, start + SOURCE_BYTES);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (identityBytes(JSON.stringify({ memories: [fragment(middle)] })) <= SOURCE_BYTES) low = middle;
      else high = middle - 1;
    }
    let end = low;
    if (end < memory.content.length && end > start && /[\uD800-\uDBFF]/.test(memory.content[end - 1]!)) end--;
    const item = fragment(end);
    if (end === start && memory.content.length > start || identityBytes(JSON.stringify({ memories: [item] })) > SOURCE_BYTES) return invalid();
    if (page.length && identityBytes(JSON.stringify({ memories: [...page, item] })) > SOURCE_BYTES) return { memories: page, cursor: { sourceIndex, start } };
    page.push(item);
    if (end === memory.content.length) { sourceIndex++; start = 0; } else start = end;
  }
  return page.length ? { memories: page, cursor: { sourceIndex, start } } : null;
}
