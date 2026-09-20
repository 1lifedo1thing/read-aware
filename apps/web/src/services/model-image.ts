import { AppError, MODEL_IMAGE_MAX_BYTES, type ModelImageInput } from "@read-aware/core";
import type { ResourceOwner } from "./resource-owner";
import { nativeResourceFiles } from "../platform/resource-files";

/** Decode inside native resource ownership before sending a bounded inert PNG to inference. */
export async function resourceModelImage(owner: ResourceOwner, id: string, signal?: AbortSignal): Promise<ModelImageInput> {
  const png = await owner.imagePreview(id, signal);
  return pngModelImage(png, signal);
}

export async function pngModelImage(png: Blob, signal?: AbortSignal): Promise<ModelImageInput> {
  signal?.throwIfAborted();
  if (png.type !== "image/png" || !png.size || png.size > MODEL_IMAGE_MAX_BYTES) throw new AppError("ai/image-budget-exceeded", "Decoded image exceeds model input budget");
  const bytes = new Uint8Array(await png.arrayBuffer());
  signal?.throwIfAborted();
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  return { mimeType: "image/png", data: btoa(binary) };
}

/** Reuse the resource decoder's dimension/byte limits, PNG normalization and
 * 2048px downsampling for user uploads and cached web illustrations. */
export async function decodeModelImage(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  if (!blob.size || blob.size > 16 * 1024 * 1024) throw new AppError("ai/image-budget-exceeded", "Image exceeds decoding budget");
  signal?.throwIfAborted();
  const resource = await nativeResourceFiles.create();
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      signal?.throwIfAborted();
      await nativeResourceFiles.append(resource.id, offset, bytes.subarray(offset, offset + 1024 * 1024));
    }
    await nativeResourceFiles.commit(resource.id);
    signal?.throwIfAborted();
    const png = await nativeResourceFiles.imagePreview(resource.id);
    signal?.throwIfAborted();
    return new Blob([png], { type: "image/png" });
  } finally { await nativeResourceFiles.release(resource.id); }
}
