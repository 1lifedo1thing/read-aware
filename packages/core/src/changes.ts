import { AppError } from "./errors";
export const CHANGE_AREAS = ["library", "reading", "annotations", "conversations", "memory", "settings", "documents"] as const;
export type ChangeArea = typeof CHANGE_AREAS[number];
export type ChangesQuery = { areas: ChangeArea[]; bookId?: string; settingsPaths?: string[]; collection?: string };
/** Conservative invalidations only: read current authorized state through its
 * ordinary domain API. Neither event payloads nor deleted values are exposed. */
export type ChangeNotice = { areas: ChangeArea[]; bookId?: string; collection?: string; id?: string };
export type ChangesPage = { changes: ChangeNotice[]; cursor: string; hasMore: boolean };
export interface ChangesPort {
  /** Capture before loading a baseline snapshot, then read changes after it. */
  open(query: ChangesQuery, signal?: AbortSignal): Promise<{ cursor: string }>;
  read(query: ChangesQuery, cursor: string, limit?: number, signal?: AbortSignal): Promise<ChangesPage>;
}
export function normalizeChangesQuery(input: unknown): ChangesQuery {
  const fail = (): never => { throw new AppError("changes/invalid-query", "Invalid change query"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 512 && !/[\u0000-\u001f]/u.test(x);
  if (Object.keys(value).some(key => !["areas", "bookId", "settingsPaths", "collection"].includes(key))
    || !Array.isArray(value.areas) || !value.areas.length || value.areas.length > CHANGE_AREAS.length
    || value.areas.some(area => !CHANGE_AREAS.includes(area))) return fail();
  const areas = [...new Set(value.areas as ChangeArea[])].sort();
  if (value.bookId !== undefined && !text(value.bookId) || value.collection !== undefined && (!text(value.collection) || !areas.includes("documents"))) return fail();
  if (value.settingsPaths !== undefined && (!areas.includes("settings") || !Array.isArray(value.settingsPaths)
    || value.settingsPaths.length > 32 || value.settingsPaths.some(path => !text(path)))) return fail();
  if (areas.includes("settings") && !(value.settingsPaths as unknown[] | undefined)?.length) return fail();
  return { areas, ...(value.bookId ? { bookId: value.bookId as string } : {}), ...(value.collection ? { collection: value.collection as string } : {}),
    ...(value.settingsPaths ? { settingsPaths: [...new Set(value.settingsPaths as string[])].sort() } : {}) };
}
