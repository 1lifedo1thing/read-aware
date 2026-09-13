import { afterEach, expect, spyOn, test } from "bun:test";
import { Archive } from "libarchive.js";
import { buildComicArchiveBook } from "./comic-archive";

const restore: Array<() => void> = [];
afterEach(() => { for (const reset of restore.splice(0)) reset(); });
function fixture(files: Array<{ path: string; file: { name: string } }>) {
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
  let decodeFailure: Error | undefined;
  Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    src = "";
    async decode() { if (decodeFailure) throw decodeFailure; }
  } });
  restore.push(() => {
    if (imageDescriptor) Object.defineProperty(globalThis, "Image", imageDescriptor);
    else Reflect.deleteProperty(globalThis, "Image");
  });
  let closed = 0;
  const extracted: string[] = [];
  const archive = {
    getFilesArray: async () => files,
    extractSingleFile: async (path: string) => { extracted.push(path); return new File(["image"], path); },
    close: async () => { closed++; },
  };
  const open = spyOn(Archive, "open").mockResolvedValue(archive as unknown as Awaited<ReturnType<typeof Archive.open>>);
  restore.push(() => open.mockRestore());
  return { archive, extracted, get closed() { return closed; }, failDecode(error: Error) { decodeFailure = error; } };
}
const source = () => new File(["synthetic archive"], "fixture.cbr");

test("public archive entries keep root/nested paths, uppercase images and numeric page order", async () => {
  const f = fixture([
    { path: "", file: { name: "cover.PNG" } },
    { path: "pages/", file: { name: "page10.png" } },
    { path: "pages/", file: { name: "page2.PNG" } },
    { path: "", file: { name: "readme.txt" } },
  ]);
  const book = await buildComicArchiveBook(source());
  expect(book.sections.map(section => section.id)).toEqual(["cover.PNG", "pages/page2.PNG", "pages/page10.png"]);
  await book.getCover!();
  expect(f.extracted).toEqual(["cover.PNG"]);
  await book.destroy!(); expect(f.closed).toBe(1);
});

test("damaged page decoding rejects reading and cover with a stable error and releases URLs", async () => {
  const f = fixture([{ path: "", file: { name: "broken.png" } }]);
  f.failDecode(new Error("Cannot decode image"));
  const revoke = spyOn(URL, "revokeObjectURL");
  restore.push(() => revoke.mockRestore());
  const book = await buildComicArchiveBook(source());
  await expect(book.sections[0]!.load!()).rejects.toMatchObject({ code: "reader/render-failed" });
  await expect(book.getCover!()).rejects.toMatchObject({ code: "reader/render-failed" });
  expect(revoke).toHaveBeenCalledTimes(2);
  await book.destroy!();
  expect(f.closed).toBe(1);
});

test("failed enumeration and archives without image pages close their decoder", async () => {
  const f = fixture([]);
  await expect(buildComicArchiveBook(source())).rejects.toThrow("No supported image");
  expect(f.closed).toBe(1);
  f.archive.getFilesArray = async () => { throw Error("truncated archive"); };
  await expect(buildComicArchiveBook(source())).rejects.toThrow("truncated archive");
  expect(f.closed).toBe(2);
});
