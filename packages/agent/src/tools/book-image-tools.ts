import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { validateModelImages, MODEL_IMAGES_MAX_COUNT, MODEL_IMAGES_MAX_BYTES, AppError, normalizeBookImageQuery, normalizeBookImagesQuery, type BookImageQuery, type BookImagesQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";
import { assertSpoilerPermission, confirmSpoilerSchema, spoilerGranted } from "./book-text-tools";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";

const imageParameters = Type.Object({ image: Type.Object({ bookId: Type.String({ minLength: 1, maxLength: 512 }),
  contentVersion: Type.String({ minLength: 1, maxLength: 256 }), sectionIndex: Type.Integer({ minimum: 0 }), index: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false });

export function buildBookImageTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  function access(bookId: string, raw: unknown) {
    if (scope.kind === "book" && bookId !== scope.bookId) throw new AppError("memory/forbidden", "Images belong to another book");
    const current = scope.kind === "book", grant = spoilerGranted(raw);
    assertSpoilerPermission(grant, state, current);
    return { current, grant, fence: current && state?.spoilerFence && !grant ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {} };
  }
  let imageCount = 0, imageBytes = 0;
  return [{
    name: "list_book_images", label: "Book illustrations",
    description: "List authored image candidates in one versioned book section without navigating or fetching remote URLs; PDF operator inspection may decode embedded objects. Use sectionIndex/contentVersion from get_navigation_toc, not extracted chapter numbering. Returns up to 20 bounded alt labels, source locations and opaque image descriptors; continue with nextOffset. Covers img/SVG, srcset/picture alternatives, authored CSS image URLs and PDF embedded bitmaps. CSS candidates are declarations, not the active viewport/cascade. PDF masks depending on page paint state return unsupported when read. Footnote marker images are excluded. Unsupported is distinct from an empty supported section. Current narrative sections remain behind the reading fence.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), contentVersion: Type.String({ minLength: 1, maxLength: 256 }),
      sectionIndex: Type.Integer({ minimum: 0 }), offset: Type.Optional(Type.Integer({ minimum: 0 })), confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { confirmSpoiler, ...input } = params as Omit<BookImagesQuery, "bookId"> & { bookId?: string; confirmSpoiler?: unknown };
      const query = normalizeBookImagesQuery({ ...input, bookId: resolveBookId(scope, input.bookId), limit: 20 });
      const { current, grant, fence } = access(query.bookId, confirmSpoiler);
      const result = await deps.bookText.listImages({ ...query, ...fence }, signal);
      signal?.throwIfAborted(); if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "open_book_image_resource", label: "Prepare book illustration", executionMode: "sequential",
    description: "Copy one embedded image from list_book_images into this conversation's temporary sealed resource. Copy the descriptor unchanged. Rechecks source section/version and narrative reading fence before loading; no network requests or original-book export bypass. Returns ready/missing/external/unsupported; ready means bytes copied, NOT decoded pixels or visual understanding. No image bytes, source URL or paths enter the model, and no viewer opens. Max 16 MiB; references last one hour and share existing resource quotas. Use save_resource or copy_resource_image only on user intent; clipboard decoding may reject unsupported formats. Release the reference when finished.",
    parameters: imageParameters,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookImageQuery(input), { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
      const result = await deps.bookText.openImageResource(threadScopeKey(scope), { ...query, ...fence }, signal);
      signal?.throwIfAborted(); if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "show_book_image", label: "Show book illustration", executionMode: "sequential",
    description: "On explicit user intent, open an embedded image from list_book_images in the currently open book's native lightbox. Copy its versioned descriptor unchanged; open that book first. Preserves the narrative reading fence and does not fetch remote images or navigate. Opened means the matching viewer committed, not successful pixel decoding or model vision. Returns not-opened for missing/external/unsupported images. Use the returned snapshot.id with control_reader_image to zoom, pan, rotate, reset or close. No temporary resource handle is created; viewer bytes are released on replacement/close. A later user click, request or book change supersedes a pending opening.",
    parameters: imageParameters,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookImageQuery(input), { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
      const session = await deps.reader.getSession();
      signal?.throwIfAborted();
      if (session.status !== "ready" || !session.sessionId) throw new AppError("reader/unavailable", "Open the image book first");
      const result = await deps.reader.openImage({ ...query, ...fence }, signal, { sessionId: session.sessionId, bookId: query.image.bookId });
      signal?.throwIfAborted(); if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "read_book_image", label: "Read book illustration", executionMode: "sequential",
    description: "Inspect one versioned illustration from list_book_images with the current vision model. Rechecks original source/version and narrative fence; no remote image fetch or original-book bypass. The host decodes a bounded PNG and returns an actual image block to the model. Missing/external/unsupported remain explicit. Maximum 4 images/16 MiB per turn, 8 MiB per image; source decoding also has dimension limits. The temporary resource is released automatically. Image blocks are omitted from later turns; reread a descriptor when needed. This does not open a viewer or guarantee semantic recognition.",
    parameters: imageParameters,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookImageQuery(input), { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
      if (state?.modelSupportsImages === false) throw new AppError("ai/image-unsupported", "Current model does not support image inputs");
      if (!deps.bookText.readImageInput) throw new AppError("library/content-unavailable", "Image model input is unavailable");
      if ((state?.modelImageCount ?? imageCount) >= MODEL_IMAGES_MAX_COUNT) throw new AppError("ai/image-budget-exceeded", "This turn has reached its image input limit");
      const result = await deps.bookText.readImageInput(threadScopeKey(scope), { ...query, ...fence }, signal);
      signal?.throwIfAborted();
      if (result.status !== "ready") return textResult(result);
      const [image] = validateModelImages([result.input]);
      const bytes = image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
      if ((state?.modelImageBytes ?? imageBytes) + bytes > MODEL_IMAGES_MAX_BYTES) throw new AppError("ai/image-budget-exceeded", "This turn has reached its image byte limit");
      if (state) { state.modelImageCount = (state.modelImageCount ?? 0) + 1; state.modelImageBytes = (state.modelImageBytes ?? 0) + bytes; }
      else { imageCount++; imageBytes += bytes; }
      if (state && current && grant) state.spoilerGranted = true;
      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "ready", image: result.image }) }, { type: "image" as const, ...image }], details: undefined };
    },
  }];
}
