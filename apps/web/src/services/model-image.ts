import { AppError, MODEL_IMAGE_MAX_BYTES, type ModelImageInput } from "@read-aware/core";
import type { ResourceOwner } from "./resource-owner";

/** Decode inside native resource ownership before sending a bounded inert PNG to inference. */
export async function resourceModelImage(owner: ResourceOwner, id: string, signal?: AbortSignal): Promise<ModelImageInput> {
  const png = await owner.imagePreview(id, signal);
  signal?.throwIfAborted();
  if (png.type !== "image/png" || !png.size || png.size > MODEL_IMAGE_MAX_BYTES) throw new AppError("ai/image-budget-exceeded", "Decoded image exceeds model input budget");
  const bytes = new Uint8Array(await png.arrayBuffer());
  signal?.throwIfAborted();
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  return { mimeType: "image/png", data: btoa(binary) };
}
