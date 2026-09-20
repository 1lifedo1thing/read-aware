import { createRequestCache } from "../../../platform/request-cache";
import { invoke } from "../../../platform/ipc";
import { isTauri } from "../../../platform/environment";
import { appHttpFetch } from "../../../platform/http-client";
import { createLogger } from "../../../platform/logger";
import { loadWebImage } from "./web-image";

const log = createLogger("web-image-cache");
// Same v1 wire format as native web_image_cache.rs. Empty bytes mean a miss.
const MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const memory = createRequestCache<Blob>({ ttlMs: 30 * 60_000, maxBytes: 24 * 1024 * 1024, maxEntries: 64, sizeOf: blob => blob.size });
export async function cachedWebImage(url: string, signal: AbortSignal): Promise<Blob> {
  return memory.get(url, async signal => {
    const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (isTauri()) {
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("web_image_cache_get", { key }));
        if (bytes.length > 1 && bytes.length <= 4 * 1024 * 1024 + 1 && MIMES[bytes[0]!]) return new Blob([bytes.subarray(1)], { type: MIMES[bytes[0]!] });
      } catch (error) { log.warn("Image disk cache read failed; fetching the source", error); }
    }
    signal.throwIfAborted();
    const blob = await loadWebImage(url, isTauri() ? appHttpFetch : fetch, signal);
    if (isTauri()) {
      // A disposable cache write is not on the first-paint critical path.
      void blob.arrayBuffer().then(bytes => invoke("web_image_cache_put", bytes, { headers: { "x-image-key": key, "x-image-mime": blob.type } }))
        .catch(error => log.warn("Image disk cache write failed; preview remains usable", error));
    }
    return blob;
  }, signal);
}
