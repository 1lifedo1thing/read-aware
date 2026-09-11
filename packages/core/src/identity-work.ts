import { AppError } from "./errors";

export const IDENTITY_WORK_LIMITS = { maxPages: 4096, maxPageBytes: 48_000 } as const;
export type IdentityWorkQuery = { expectedRevision: string; index: number };
export type IdentityWorkAppend = IdentityWorkQuery & { json: string };
export type IdentityWorkPage = { revision: string; index: number; pageCount: number; json: string | null };
export type IdentityWorkReceipt = { revision: string; pageCount: number; status: "appended" | "retained" };
export type IdentityWorkPort = {
  read(input: IdentityWorkQuery, signal?: AbortSignal): Promise<IdentityWorkPage>;
  append(input: IdentityWorkAppend, signal?: AbortSignal): Promise<IdentityWorkReceipt>;
};

function invalid(): never { throw new AppError("memory/invalid-input", "Invalid identity work page"); }
export function normalizeIdentityWorkQuery(input: IdentityWorkQuery): IdentityWorkQuery {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "expectedRevision" && key !== "index")
    || typeof input.expectedRevision !== "string" || !/^icg1:[a-f0-9]{64}$/.test(input.expectedRevision)
    || !Number.isInteger(input.index) || input.index < 0 || input.index >= IDENTITY_WORK_LIMITS.maxPages) return invalid();
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
