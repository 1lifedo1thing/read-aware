import { AppError } from "./errors";
import { CONTRIBUTION_CATALOG, type ContributionId } from "./capabilities";

export type HostExportDescription = { filename: string; byteLength: number; mimeType?: string };
export type HostExportFile = { filename: string; content: string | Uint8Array | ArrayBuffer; mimeType?: string };
export type PluginDirectoryQuery = { search?: string; offset?: number; limit?: number };
export type PluginDirectoryEntry = {
  id: string; name: string; version: string; builtin: boolean;
  /** Configured enabled state, not proof that every contribution is active. */
  enabled: boolean; activationFailed: boolean;
};
export type PluginDirectoryPage = { plugins: PluginDirectoryEntry[]; total: number; offset: number; nextOffset: number | null };
export type PluginContributionQuery = PluginDirectoryQuery & { point?: ContributionId; pluginId?: string };
export type PluginContributionEntry = {
  point: ContributionId; pluginId: string;
  /** Registry key, not a callable handle or a universal settings value. */
  key: string;
};
export type PluginContributionPage = { contributions: PluginContributionEntry[]; total: number; offset: number; nextOffset: number | null };

export function normalizePluginContributionQuery(value: PluginContributionQuery = {}): Required<PluginDirectoryQuery> & Pick<PluginContributionQuery, "point" | "pluginId"> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["point", "pluginId", "search", "offset", "limit"].includes(key))) return invalid("Invalid contribution query");
  const { point, pluginId, search, offset, limit } = value;
  if (point !== undefined && (typeof point !== "string" || !Object.prototype.hasOwnProperty.call(CONTRIBUTION_CATALOG, point))
    || pluginId !== undefined && (typeof pluginId !== "string" || !pluginId.length || pluginId.length > 256)) return invalid("Invalid contribution filter");
  return { ...normalizePluginDirectoryQuery({ search, offset, limit }), ...(point === undefined ? {} : { point }), ...(pluginId === undefined ? {} : { pluginId }) };
}

const invalid = (message: string): never => { throw new AppError("ui/invalid-target", message); };
export function normalizeClipboardText(value: unknown): string {
  if (typeof value !== "string" || value.length > 1_000_000) return invalid("Clipboard text must contain at most 1000000 characters");
  return value;
}
export function normalizeExternalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return invalid("Invalid external URL");
  let url: URL;
  try { url = new URL(value); } catch { return invalid("Invalid external URL"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return invalid("Only HTTP(S) URLs without credentials may be opened");
  return url.href;
}
/** Metadata-only export validation shared by inspection and actual export. */
export function normalizeHostExportDescription(value: HostExportDescription): HostExportDescription {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["filename", "byteLength", "mimeType"].includes(key))
    || typeof value.filename !== "string" || !value.filename.trim() || value.filename.length > 256
    || value.mimeType !== undefined && (typeof value.mimeType !== "string" || value.mimeType.length > 256 || /[\r\n]/.test(value.mimeType))
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > 64 * 1024 * 1024) return invalid("Invalid export description or size");
  return { filename: value.filename, byteLength: value.byteLength,
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }) };
}
export function describeHostExport(value: HostExportFile): HostExportDescription {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["filename", "content", "mimeType"].includes(key))) return invalid("Invalid export description");
  const content = value.content;
  if (typeof content !== "string" && !(content instanceof Uint8Array) && !(content instanceof ArrayBuffer)) return invalid("Export requires text or bytes");
  return normalizeHostExportDescription({ filename: value.filename,
    byteLength: typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength,
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }) });
}
export function normalizeHostExport(value: HostExportFile): HostExportFile {
  const description = describeHostExport(value);
  return { filename: description.filename, content: typeof value.content === "string" ? value.content : value.content.slice(0),
    ...(description.mimeType === undefined ? {} : { mimeType: description.mimeType }) };
}
export function normalizePluginDirectoryQuery(value: PluginDirectoryQuery = {}): Required<PluginDirectoryQuery> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["search", "offset", "limit"].includes(key))) return invalid("Invalid plugin directory query");
  const { search = "", offset = 0, limit = 50 } = value;
  if (typeof search !== "string" || search.length > 200 || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return invalid("Invalid plugin directory bounds");
  return { search: search.trim().toLowerCase(), offset, limit };
}
