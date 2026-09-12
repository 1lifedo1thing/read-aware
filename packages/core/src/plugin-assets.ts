/** Durable names are scoped to one plugin ID; opening creates a new ephemeral
 * ResourceRef owned by the current activation. No filesystem/blob IDs escape. */
export type PluginAsset = {
  key: string; revision: string; name: string; mimeType: string; size: number; updatedAt: string;
};
export type PluginAssetQuery = { limit?: number; after?: string };
/** Key-ordered pagination, not an immutable multi-page snapshot. */
export type PluginAssetPage = { items: PluginAsset[]; nextAfter: string | null };
export type PluginAssetWrite = { key: string; expectedRevision: string | null; name?: string };
export type PluginAssetReceipt = { asset: PluginAsset; cleanupPending: boolean };
export type PluginAssetPolicy = {
  storage: "local"; backup: "complete"; uninstall: "delete";
  maxAssets: number; maxBytes: number; maxAssetBytes: number; usedAssets: number; usedBytes: number;
};
export const PLUGIN_ASSET_MAX_BYTES = 64 * 1024 * 1024;
export const PLUGIN_ASSET_TOTAL_BYTES = 512 * 1024 * 1024;
export const PLUGIN_ASSET_MAX_COUNT = 256;
