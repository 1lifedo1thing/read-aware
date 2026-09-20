import { AppError } from "@read-aware/core";
import type { TurnImage, RuntimeDeps } from "@read-aware/agent";
import { invoke } from "../../../platform/ipc";
import { decodeModelImage, pngModelImage } from "../../../services/model-image";
import { cachedWebImage } from "./web-image-cache";
import type { ChatImageAttachment, ChatMessage } from "./chat-types";

/** Local disposable image cache, shared quotas with web previews. Only opaque
 * content hashes/names enter messages. No pixel data enters events or R2. */
export async function storeChatImage(file: File, signal?: AbortSignal): Promise<ChatImageAttachment> {
  const png = await decodeModelImage(file, signal);
  if (png.size > 4 * 1024 * 1024) throw new AppError("ai/image-budget-exceeded", "Image exceeds local preview budget");
  const bytes = await png.arrayBuffer();
  const cacheKey = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  signal?.throwIfAborted();
  await invoke("web_image_cache_put", bytes, { headers: { "x-image-key": cacheKey, "x-image-mime": "image/png" } });
  return { kind: "image", cacheKey, name: file.name.slice(0, 256) || "image.png" };
}

export async function loadChatImage(cacheKey: string): Promise<Blob> {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) throw new AppError("ai/invalid-image", "Invalid local image reference");
  const bytes = new Uint8Array(await invoke<ArrayBuffer>("web_image_cache_get", { key: cacheKey }));
  if (bytes.length <= 1 || bytes[0] !== 1) throw new AppError("ai/invalid-image", "Local image expired or unavailable on this device");
  return new Blob([bytes.subarray(1)], { type: "image/png" });
}

export const chatImagePort: NonNullable<RuntimeDeps["images"]> = {
  async read(image, signal) {
    const timeout = AbortSignal.timeout(8000);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const decodeUrl = async (url: string) => decodeModelImage(await cachedWebImage(url, bounded), bounded);
    const png = image.kind === "local" ? await loadChatImage(image.cacheKey)
      : await decodeUrl(image.thumbnailUrl ?? image.url).catch(error => {
        // Match the displayed card: a broken thumbnail may still have a usable original.
        bounded.throwIfAborted();
        if (!image.thumbnailUrl || image.thumbnailUrl === image.url) throw error;
        return decodeUrl(image.url);
      });
    return pngModelImage(png, bounded);
  },
};

export function messageImages(message: ChatMessage): TurnImage[] {
  return [
    ...(message.attachments ?? []).flatMap(a => a.kind === "image" ? [{ kind: "local" as const, cacheKey: a.cacheKey, name: a.name }] : []),
    ...(message.parts ?? []).flatMap(p => p.type === "reference" && p.reference.kind === "web-images"
      ? p.reference.images.map(image => ({ kind: "web" as const, url: image.url, thumbnailUrl: image.thumbnailUrl, name: image.title })) : []),
  ];
}
