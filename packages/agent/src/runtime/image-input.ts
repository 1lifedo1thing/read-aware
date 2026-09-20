import { AppError, validateModelImages, MODEL_IMAGES_MAX_BYTES, MODEL_IMAGES_MAX_COUNT, type ModelImageInput } from "@read-aware/core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { RuntimeDeps, TurnImage } from "../ports";
import type { AgentTurnState } from "../tools/turn-state";

export function reserveModelImages(inputs: ModelImageInput[], state: AgentTurnState): ModelImageInput[] {
  const images = validateModelImages(inputs);
  const bytes = images.reduce((sum, image) => sum + image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0), 0);
  if ((state.modelImageCount ?? 0) + images.length > MODEL_IMAGES_MAX_COUNT || (state.modelImageBytes ?? 0) + bytes > MODEL_IMAGES_MAX_BYTES)
    throw new AppError("ai/image-budget-exceeded", "This turn has reached its image input limit");
  state.modelImageCount = (state.modelImageCount ?? 0) + images.length;
  state.modelImageBytes = (state.modelImageBytes ?? 0) + bytes;
  return images;
}

/** Ref hydration happens only at the current user turn, never in durable history. */
export async function prepareImageInputs(images: TurnImage[], deps: RuntimeDeps, state: AgentTurnState, signal?: AbortSignal): Promise<(TextContent | ImageContent)[]> {
  if (!images.length) return [];
  if (!state.modelSupportsImages) return [{ type: "text", text: "[Images were supplied, but this model has no vision input support. No pixels were read. Say so when the question depends on images; ask for a vision-capable model or a text description. Do not invent their contents.]" }];
  const results = await Promise.all(images.slice(0, MODEL_IMAGES_MAX_COUNT).map(async image => {
    try {
      if (!deps.images) throw new AppError("ai/invalid-image", "Image input port unavailable");
      return { image, input: await deps.images.read(image, signal) };
    } catch (error) {
      signal?.throwIfAborted(); deps.log?.warn("Conversation image unavailable", error);
      return { image, input: null };
    }
  }));
  signal?.throwIfAborted();
  const content: (TextContent | ImageContent)[] = [];
  for (const { image, input } of results) {
    content.push({ type: "text", text: `Image attachment: ${image.name}. ${image.kind === "web" ? "From the preceding answer; its earlier caption is unverified." : "Supplied by the reader."}` });
    if (input) content.push({ type: "image", ...reserveModelImages([input], state)[0]! });
    else content.push({ type: "text", text: "[Image pixels unavailable on this device. Do not infer its contents; explain the missing image if needed.]" });
  }
  if (images.length > MODEL_IMAGES_MAX_COUNT) content.push({ type: "text", text: "[Additional earlier images omitted to respect the per-turn image budget.]" });
  return content;
}
