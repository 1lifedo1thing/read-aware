import { AppError } from "./errors";

/** Host-decoded PNG input. Opaque resource IDs are resolved before constructing this object. */
export type ModelImageInput = { mimeType: "image/png"; data: string };
export const MODEL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MODEL_IMAGES_MAX_BYTES = 16 * 1024 * 1024;
export const MODEL_IMAGES_MAX_COUNT = 4;

export function validateModelImages(value: unknown): ModelImageInput[] {
  if (!Array.isArray(value) || value.length > MODEL_IMAGES_MAX_COUNT) throw new AppError("ai/image-budget-exceeded", "Too many model images");
  let total = 0;
  return Array.from(value, image => {
    if (!image || typeof image !== "object" || image.mimeType !== "image/png" || typeof image.data !== "string"
      || Object.keys(image).some(key => key !== "mimeType" && key !== "data")) throw new AppError("ai/invalid-image", "Invalid model image input");
    const data = image.data as string;
    if (!data.length || data.length > Math.ceil(MODEL_IMAGE_MAX_BYTES / 3) * 4 || data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new AppError("ai/image-budget-exceeded", "Invalid or oversized model image");
    const bytes = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (bytes > MODEL_IMAGE_MAX_BYTES || (total += bytes) > MODEL_IMAGES_MAX_BYTES) throw new AppError("ai/image-budget-exceeded", "Model image byte budget exceeded");
    return { mimeType: "image/png", data };
  });
}
