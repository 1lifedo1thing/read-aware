/**
 * RAR comic archives (`.cbr`) as foliate books.
 *
 * The vendored engine reads `.cbz` because a ZIP reader is already in it; RAR
 * needs a decoder of its own, so this builds the same fixed-layout book shape
 * `comic-book.js` produces — page images and all — on top of libarchive (WASM,
 * in a worker, so decoding never blocks the reader).
 *
 * Pages are extracted one at a time, on demand: a scanned volume runs to
 * hundreds of megabytes and the reader only ever shows a spread.
 */
import { Archive } from "libarchive.js";
import { AppError } from "@read-aware/core";
import { escapeHtml } from "./section-document";
import type { FoliateBook } from './foliate-engine';

/** Served as a static asset, like the reading engine — see its `VENDOR.md`. */
const WORKER_URL = "/libarchive/worker-bundle.js";

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".jxl",
  ".avif",
];

let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  Archive.init({ workerUrl: WORKER_URL });
  initialized = true;
}

const pageHtml = (src: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
  `<body style="margin: 0"><img src="${escapeHtml(src)}"></body></html>`;

export async function buildComicArchiveBook(file: File): Promise<FoliateBook> {
  ensureInitialized();
  const archive = await Archive.open(file);
  let entries: string[];
  try {
    // CompressedFile leaves retain an archive back-reference. Let the public
    // flattening API recognize them instead of traversing their internals.
    const files: Array<{ path: string; file: { name: string } | string }> = await archive.getFilesArray();
    entries = files.map(({ path, file }) => path + (typeof file === "string" ? file : file.name));
  } catch (error) {
    await archive.close();
    throw error;
  }

  const collator = new Intl.Collator([], { numeric: true });
  const pages = entries
    .filter((path) => {
      const lower = path.toLowerCase();
      return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
    })
    .sort(collator.compare);

  if (pages.length === 0) {
    await archive.close();
    throw new Error("No supported image files in archive");
  }

  const urls = new Map<number, string[]>();
  const imageUrlFor = async (path: string) => {
    const extracted = await archive.extractSingleFile(path);
    const url = URL.createObjectURL(extracted);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { extracted, url };
    } catch (cause) {
      URL.revokeObjectURL(url);
      throw new AppError("reader/render-failed", `Comic page could not be decoded: ${path}`, { cause });
    }
  };
  const load = async (index: number) => {
    const existing = urls.get(index);
    if (existing) return existing[1]!;
    const { url: imageUrl } = await imageUrlFor(pages[index]!);
    const pageUrl = URL.createObjectURL(new Blob([pageHtml(imageUrl)], { type: "text/html" }));
    urls.set(index, [imageUrl, pageUrl]);
    return pageUrl;
  };
  const unload = (index: number) => {
    urls.get(index)?.forEach((url) => URL.revokeObjectURL(url));
    urls.delete(index);
  };

  return {
    metadata: { title: file.name, author: "" },
    rendition: { layout: "pre-paginated" },
    sections: pages.map((path, index) => ({
      id: path,
      load: () => load(index),
      createDocument: () => {
        const doc = document.implementation.createHTMLDocument();
        const image = doc.createElement("img");
        image.setAttribute("src", path);
        doc.body.append(image);
        return doc;
      },
      loadImage: () => archive.extractSingleFile(path),
      unload: () => unload(index),
      size: 1000,
    })),
    toc: pages.map((path) => ({ label: path, href: path })),
    resolveHref: (href: string) => ({ index: Math.max(0, pages.indexOf(href)) }),
    splitTOCHref: (href: string) => [href, null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    getCover: async () => {
      const { extracted, url } = await imageUrlFor(pages[0]!);
      URL.revokeObjectURL(url);
      return extracted;
    },
    destroy: async () => {
      for (const index of [...urls.keys()]) unload(index);
      await archive.close();
    },
  };
}
