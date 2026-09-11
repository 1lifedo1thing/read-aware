import { AppError } from "./errors";

export const IDENTITY_WORK_LIMITS = { maxPages: 4096, maxPageBytes: 48_000, maxCheckpointBytes: 256_000 } as const;
export type IdentityWorkQuery = { expectedRevision: string; index: number };
export type IdentityWorkAppend = IdentityWorkQuery & { json: string };
export type IdentityWorkCompact = { expectedRevision: string; expectedPageCount: number; json: string };
export type IdentityWorkPage = { revision: string; index: number; pageCount: number; baseIndex: number; checkpoint: string | null; json: string | null };
export type IdentityWorkReceipt = { revision: string; pageCount: number; status: "appended" | "retained" | "compacted" };
export type IdentityWorkPort = {
  compact(input: IdentityWorkCompact, signal?: AbortSignal): Promise<IdentityWorkReceipt>;
  read(input: IdentityWorkQuery, signal?: AbortSignal): Promise<IdentityWorkPage>;
  append(input: IdentityWorkAppend, signal?: AbortSignal): Promise<IdentityWorkReceipt>;
};

function invalid(): never { throw new AppError("memory/invalid-input", "Invalid identity work page"); }
export function normalizeIdentityWorkQuery(input: IdentityWorkQuery): IdentityWorkQuery {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "expectedRevision" && key !== "index")
    || typeof input.expectedRevision !== "string" || !/^icg1:[a-f0-9]{64}$/.test(input.expectedRevision)
    || !Number.isSafeInteger(input.index) || input.index < 0 || input.index >= Number.MAX_SAFE_INTEGER) return invalid();
  return { expectedRevision: input.expectedRevision, index: input.index };
}
/** Internal scratch data is never a profile projection or evidence of completed inference. */
export function normalizeIdentityWorkAppend(input: IdentityWorkAppend): IdentityWorkAppend {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["expectedRevision", "index", "json"].includes(key))
    || typeof input.json !== "string" || new TextEncoder().encode(input.json).length > IDENTITY_WORK_LIMITS.maxPageBytes) return invalid();
  const query = normalizeIdentityWorkQuery({ expectedRevision: input.expectedRevision, index: input.index });
  let parsed: unknown;
  try { parsed = JSON.parse(input.json); } catch { return invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid();
  return { ...query, json: input.json };
}

/** Compare the monotonic tail, then atomically replace consumed pages with their frontier. */
export function normalizeIdentityWorkCompact(input: IdentityWorkCompact): IdentityWorkCompact {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["expectedRevision", "expectedPageCount", "json"].includes(key))
    || !Number.isSafeInteger(input.expectedPageCount) || input.expectedPageCount < 1
    || typeof input.json !== "string" || new TextEncoder().encode(input.json).length > IDENTITY_WORK_LIMITS.maxCheckpointBytes) return invalid();
  normalizeIdentityWorkQuery({ expectedRevision: input.expectedRevision, index: input.expectedPageCount - 1 });
  let value: unknown;
  try { value = JSON.parse(input.json); } catch { return invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return { expectedRevision: input.expectedRevision, expectedPageCount: input.expectedPageCount, json: input.json };
}
