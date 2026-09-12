import { expect, test } from "bun:test";
import { srcsetUrls } from "../src/features/library/lib/book-image-candidates";
import { listImagesInBook, readImageInBook } from "../src/features/library/lib/book-images";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { EPUB } from "../foliate-js/src/epub";
import { makeEPUBFixture } from "./fixtures/foliate-epub";
import { withDom } from "./helpers/foliate-dom";
import type { Book } from "../foliate-js/src/book";

const query = { bookId: "b", contentVersion: "v1", sectionIndex: 0 };
test("srcset parsing retains data URL commas and avoids treating density descriptors as paths", () => {
  expect(srcsetUrls("small.png 1x, large.png 2x")).toEqual(["small.png", "large.png"]);
  expect(srcsetUrls("data:image/png;base64,AAAA 1x, local.png 2x")).toEqual(["data:image/png;base64,AAAA", "local.png"]);
});
test("authored CSS and srcset sources append stable descriptors, preserve source DOM and never fetch external candidates", () => withDom(async () => {
  const doc = new DOMParser().parseFromString('<style>@media screen { .art { background-image: url(other.png) } }</style><picture><source srcset="wide.png 2x"><img src="base.png" srcset="base.png 1x, high.png 2x" alt="Art"></picture><div class="art" style="background-image:url(https://example.com/image)"></div>', "text/html");
  const original = doc.documentElement.outerHTML;
  const loaded: string[] = [];
  const book: Book = { sections: [{ id: "chapter", size: 1, load: () => "", createDocument: () => doc,
    loadImage: element => { loaded.push(element.getAttribute("src")!); return new Blob(["pixel"], { type: "image/png" }); } }] };
  const list = await listImagesInBook(book, query, contentCFI);
  expect(list.total).toBe(5);
  expect(list.items[0].alt).toBe("Art");
  const statuses = [];
  for (const item of list.items) statuses.push((await readImageInBook(book, { image: item.image }, contentCFI)).status);
  expect(statuses).toEqual(["ready", "ready", "ready", "external", "ready"]);
  expect(loaded).toEqual(["base.png", "wide.png", "high.png", "other.png"]);
  expect(doc.documentElement.outerHTML).toBe(original);
}));
test("EPUB linked CSS imports use archive-owned files and stylesheet-relative image URLs", () => withDom(async () => {
  const { archive, files } = makeEPUBFixture();
  files.set("OPS/style.css", '@import "other.css"; p { background-image: url("image.svg#icon"); }');
  files.set("OPS/other.css", '@import "style.css"; em { background-image: url("https://example.com/external.png"); }');
  const book = await new EPUB(archive).init();
  try {
    const list = await listImagesInBook(book, query, contentCFI);
    expect(list.total).toBe(3);
    expect((await readImageInBook(book, { image: list.items[1].image }, contentCFI)).status).toBe("ready");
    expect((await readImageInBook(book, { image: list.items[2].image }, contentCFI)).status).toBe("external");
    files.set("OPS/style.css", "x".repeat(512 * 1024 + 1));
    await expect(listImagesInBook(book, query, contentCFI)).rejects.toMatchObject({ code: "library/content-budget-exceeded" });
  } finally { book.destroy(); }
}));
