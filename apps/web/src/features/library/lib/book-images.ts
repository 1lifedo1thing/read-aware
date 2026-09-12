import { checkContentDocument, ContentBudgetError, CONTENT_QUERY_MAX_SOURCE_BYTES } from "../../../../foliate-js/src/content-budget";
import { AppError, BOOK_IMAGE_MAX_BYTES, normalizeBookImageQuery, normalizeBookImagesQuery,
  type BookImage, type BookImageQuery, type BookImagesPage, type BookImagesQuery } from "@read-aware/core";
import { loadContentNavigation, type FoliateBook } from "../../reader/lib/foliate-engine";
import type { contentCFI } from "../../../../foliate-js/src/content-navigation";
import { withBookContent } from "./book-content-source";
import { contentSections } from "./book-content-sections";

import { imageCandidates } from "./book-image-candidates";
export type BookImageData = { image: BookImage; status: "ready"; blob: Blob }
  | { image: BookImage; status: "missing" | "external" | "unsupported" };

function sectionFor(book: FoliateBook, index: number, allowed?: Set<number>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (allowed && !allowed.has(index)) throw new AppError("library/range-forbidden", "Image crosses the host reading fence");
  const section = book.sections[index];
  if (!section) throw new AppError("library/range-not-found", "Image section is missing");
  return section;
}
async function documentFor(book: FoliateBook, index: number, allowed?: Set<number>, signal?: AbortSignal) {
  const section = sectionFor(book, index, allowed, signal);
  if (section.size > CONTENT_QUERY_MAX_SOURCE_BYTES) throw new ContentBudgetError();
  const doc = await section.createDocument?.();
  signal?.throwIfAborted();
  if (doc) checkContentDocument(doc);
  return doc;
}
function describeImage(book: FoliateBook, query: BookImageQuery, element: Element, cfi: typeof contentCFI): BookImage {
  const range = element.ownerDocument.createRange();
  range.selectNode(element);
  return { image: { ...query.image }, alt: (element.getAttribute("alt") ?? element.getAttribute("aria-label") ?? "").slice(0, 300),
    location: { bookId: query.image.bookId, contentVersion: query.image.contentVersion, cfi: cfi(book, query.image.sectionIndex, range) } };
}
export async function listImagesInBook(book: FoliateBook, input: BookImagesQuery, cfi: typeof contentCFI,
  allowed?: Set<number>, signal?: AbortSignal): Promise<BookImagesPage> {
  const query = normalizeBookImagesQuery(input);
  const section = sectionFor(book, query.sectionIndex, allowed, signal);
  if (section.getImages) {
    const images = await section.getImages(signal);
    signal?.throwIfAborted();
    if (query.offset > images.length) throw new AppError("library/invalid-query", "Image offset exceeds this section");
    const end = Math.min(images.length, query.offset + query.limit);
    return { bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex,
      status: "available", total: images.length, nextOffset: end < images.length ? end : null,
      items: images.slice(query.offset, end).map((item, i) => ({
        image: { bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex, index: query.offset + i },
        alt: item.alt.slice(0, 300), location: { bookId: query.bookId, contentVersion: query.contentVersion, cfi: cfi(book, query.sectionIndex) },
      })) };
  }
  const doc = await documentFor(book, query.sectionIndex, allowed, signal);
  const nodes = doc ? await imageCandidates(book, query.sectionIndex, doc, signal) : [];
  if (query.offset > nodes.length) throw new AppError("library/invalid-query", "Image offset exceeds this section");
  const end = Math.min(nodes.length, query.offset + query.limit);
  return { bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex,
    status: doc ? "available" : "unsupported", total: nodes.length, nextOffset: end < nodes.length ? end : null,
    items: nodes.slice(query.offset, end).map(({ element }, i) => describeImage(book, { image: {
      bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex, index: query.offset + i,
    } }, element, cfi)) };
}

/** Only inline data or the parser's private archive/record loader; never fetch a source URL. */
export async function readImageInBook(book: FoliateBook, input: BookImageQuery, cfi: typeof contentCFI,
  allowed?: Set<number>, signal?: AbortSignal): Promise<BookImageData> {
  const query = normalizeBookImageQuery(input), ref = query.image;
  let image: BookImage = { image: ref, alt: "" };
  const section = sectionFor(book, ref.sectionIndex, allowed, signal);
  if (section.getImages) {
    const item = (await section.getImages(signal))[ref.index];
    signal?.throwIfAborted();
    if (!item) return { image, status: "missing" };
    image = { image: ref, alt: item.alt.slice(0, 300), location: { bookId: ref.bookId, contentVersion: ref.contentVersion, cfi: cfi(book, ref.sectionIndex) } };
    const blob = await section.readImage?.(ref.index, signal);
    signal?.throwIfAborted();
    if (!blob) return { image, status: "unsupported" };
    if (!blob.size || blob.size > BOOK_IMAGE_MAX_BYTES) throw new AppError("ui/invalid-target", "Image exceeds the byte limit or is empty");
    return { image, status: "ready", blob };
  }
  const doc = await documentFor(book, ref.sectionIndex, allowed, signal);
  if (!doc) return { image, status: "unsupported" };
  const candidate = (await imageCandidates(book, ref.sectionIndex, doc, signal))[ref.index];
  if (!candidate) return { image, status: "missing" };
  const { element } = candidate;
  image = describeImage(book, query, element, cfi);
  const src = candidate.src.trim();
  if (/^(?:https?:|\/\/)/i.test(src)) return { image, status: "external" };
  let blob: Blob | null;
  if (/^data:/i.test(src)) {
    const match = /^data:(image\/[\w.+-]+);base64,/i.exec(src);
    if (!match) return { image, status: "unsupported" };
    if (src.length > BOOK_IMAGE_MAX_BYTES * 2) throw new AppError("ui/invalid-target", "Embedded image exceeds the byte limit");
    try {
      const decoded = atob(src.slice(match[0].length).replace(/\s/g, ""));
      if (decoded.length > BOOK_IMAGE_MAX_BYTES) throw new Error("oversize");
      blob = new Blob([Uint8Array.from(decoded, char => char.charCodeAt(0))], { type: match[1].toLowerCase() });
    } catch { throw new AppError("ui/invalid-target", "Malformed or oversized inline image"); }
  } else {
    if (/[\u0000-\u001f\u007f]/.test(src) || /^(?!kindle:)[a-z][a-z\d+.-]*:/i.test(src)) return { image, status: "unsupported" };
    const load = book.sections[ref.sectionIndex].loadImage;
    if (!load) return { image, status: "unsupported" };
    try {
      const input = candidate.original ? element : doc.createElement("img");
      if (!candidate.original) input.setAttribute("src", src);
      blob = await load(input);
    }
    catch (cause) {
      signal?.throwIfAborted();
      if (cause instanceof AppError) throw cause;
      throw new AppError("library/content-unavailable", "Embedded image could not be loaded", { cause });
    }
  }
  signal?.throwIfAborted();
  if (!blob) return { image, status: "missing" };
  if (!blob.size || blob.size > BOOK_IMAGE_MAX_BYTES) throw new AppError("ui/invalid-target", "Image exceeds the byte limit or is empty");
  return { image, status: "ready", blob };
}
export function listBookImages(input: BookImagesQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]) {
  const query = normalizeBookImagesQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  return withBookContent(query.bookId, query.contentVersion, signal, async ({ book }) => {
    const { contentCFI } = await loadContentNavigation();
    return listImagesInBook(book, query, contentCFI, hrefs === undefined ? undefined : await contentSections(book, hrefs, signal), signal);
  });
}
export function readBookImage(input: BookImageQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]) {
  const query = normalizeBookImageQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  return withBookContent(query.image.bookId, query.image.contentVersion, signal, async ({ book }) => {
    const { contentCFI } = await loadContentNavigation();
    return readImageInBook(book, query, contentCFI, hrefs === undefined ? undefined : await contentSections(book, hrefs, signal), signal);
  });
}
