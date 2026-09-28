import { expect, test } from "bun:test";
import { isMOBI, MOBI } from "../foliate-js/src/mobi.js";
import { MOBI6 } from "../foliate-js/src/mobi6.js";
import { KF8 } from "../foliate-js/src/kf8.js";
import { CDIC_HEADER, HUFF_HEADER, decompressPalmDOC, getVarLen, huffcdic } from "../foliate-js/src/mobi-binary.js";
import { unzlibSync } from "./helpers/fflate";
import { makeKF8Fixture, makeMOBI6Fixture, joinBytes, writeStruct } from "./fixtures/foliate-mobi.js";
import { withDom } from "./helpers/foliate-dom.js";

test.each([1, 2] as const)("MOBI6 compression %i preserves byte-offset TOC anchors and images", (compression) =>
  withDom(async () => {
    const { file, chapter } = makeMOBI6Fixture({ compression });
    expect(await isMOBI(file)).toBe(true);
    const book = await new MOBI({ unzlib: unzlibSync }).open(file);
    try {
      expect(book).toBeInstanceOf(MOBI6);
      expect(book.metadata.title).toBe("MOBI & KF8 Fixture");
      expect(book.metadata.author).toEqual(["Ada Writer"]);
      expect(book.sections).toHaveLength(3);
      expect(book.toc?.[0].label).toBe("Second Chapter");
      const target = await book.resolveHref(`filepos:${String(chapter).padStart(10, "0")}`);
      expect(target?.index).toBe(2);
      const doc = await book.sections[2].createDocument!();
      expect(doc.querySelector("h1")?.textContent).toBe("Hello MOBI");
      expect(target?.anchor(doc)?.id).toBe(`filepos${String(chapter).padStart(10, "0")}`);
      const [a, b] = await Promise.all([book.sections[2].load(), book.sections[2].load()]);
      expect(a).toBe(b);
      if (typeof a !== "string") throw new Error("Expected document URL");
      const loaded = new DOMParser().parseFromString(await (await fetch(a)).text(), "text/html");
      const image = loaded.querySelector("img")!.src;
      expect((await fetch(image)).ok).toBe(true);
      book.destroy();
      await expect(fetch(image)).rejects.toThrow();
      await expect(fetch(a)).rejects.toThrow();
    } finally {
      book.destroy();
    }
  }),
);

test("KF8 builds skeletons and flows with typed indexes, padding and concurrent text reads", () =>
  withDom(async () => {
    const { file, raw } = makeKF8Fixture();
    const book = await new MOBI({ unzlib: unzlibSync }).open(file);
    if (!(book instanceof KF8)) throw new Error("Expected KF8 parser");
    try {
      expect(book.sections).toHaveLength(1);
      const [head, tail] = await Promise.all([book.loadRaw(0, 20), book.loadRaw(20, raw.length)]);
      expect(joinBytes(head, tail)).toEqual(raw);
      const doc = await book.sections[0].createDocument!();
      expect(doc.querySelector("#chapter")?.textContent).toBe("Hello KF8 中文");
      const [a, b] = await Promise.all([book.sections[0].load(), book.sections[0].load()]);
      expect(a).toBe(b);
      if (typeof a !== "string") throw new Error("Expected document URL");
      const loaded = new DOMParser().parseFromString(await (await fetch(a)).text(), "application/xhtml+xml");
      const css = loaded.querySelector("link")!.getAttribute("href")!;
      expect(await (await fetch(css)).text()).toContain("rgb(23, 45, 67)");
      expect(book.getSectionHref(0)).toBe("kindle:pos:fid:0000:off:0000000000");
      book.destroy();
      await expect(fetch(a)).rejects.toThrow();
      await expect(fetch(css)).rejects.toThrow();
    } finally {
      book.destroy();
    }
  }));

test("MOBI rejects encryption with an actionable code and rejects malformed compression", () =>
  withDom(async () => {
    const mobi = new MOBI({ unzlib: unzlibSync });
    await expect(mobi.open(makeMOBI6Fixture({ encrypted: true }).file)).rejects.toMatchObject({
      code: "book/unsupported-encryption",
    });
    expect(decompressPalmDOC(Uint8Array.of(65, 66, 0xc3, 0))).toEqual(Uint8Array.of(65, 66, 32, 67, 0));
    expect(() => decompressPalmDOC(Uint8Array.of(8, 1))).toThrow("Truncated");
    expect(() => decompressPalmDOC(Uint8Array.of(0x80, 0))).toThrow("Invalid PalmDOC");
    expect(() => getVarLen(Uint8Array.of(1, 2))).toThrow("Truncated");
  }));

test("MOBI strips well-formed trailing entries and reports a damaged text record as a parse failure", () =>
  withDom(async () => {
    // 0x81: a one-byte backward varint of length 1 — the entry is just itself.
    const book = await new MOBI({ unzlib: unzlibSync }).open(makeMOBI6Fixture({ trailingEntry: [0x81] }).file);
    try {
      expect((await book.sections[2].createDocument!()).querySelector("h1")?.textContent).toBe("Hello MOBI");
    } finally {
      book.destroy();
    }
    // 0x80: an entry claiming zero bytes, as in a file damaged past some record.
    await expect(
      new MOBI({ unzlib: unzlibSync }).open(makeMOBI6Fixture({ trailingEntry: [0x80] }).file),
    ).rejects.toMatchObject({ code: "book/parse-failed" });
  }));

test("a combo boundary that points at a non-header record falls back to MOBI6 instead of reading it as DRM", () =>
  withDom(async () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args[0]);
    };
    try {
      const book = await new MOBI({ unzlib: unzlibSync }).open(makeMOBI6Fixture({ kf8Boundary: 2 }).file);
      expect(book).toBeInstanceOf(MOBI6);
      book.destroy();
    } finally {
      console.warn = warn;
    }
    expect(warnings[0]).toMatchObject({ code: "book/parse-failed" });
  }));

test.each([true, false])(
  "HUFF/CDIC decodes %s first-level lookup and catches recursive dictionary cycles",
  (direct) => {
    const huff = writeStruct(HUFF_HEADER, { magic: "HUFF", offset1: 24, offset2: 1048 }, 1304);
    const view = new DataView(huff.buffer);
    for (let index = 0; index < 256; index++) view.setUint32(24 + index * 4, direct ? 0x81 : 1);
    const makeDictionary = (compressed: boolean) =>
      joinBytes(
        writeStruct(CDIC_HEADER, { magic: "CDIC", length: 16, numEntries: 1, codeLength: 1 }, 16),
        Uint8Array.of(0, 2, compressed ? 0 : 128, 1, compressed ? 0 : 65),
      );
    return (async () => {
      const decode = await huffcdic({ huffcdic: 0, numHuffcdic: 2 }, async (index) =>
        index ? makeDictionary(false).buffer : huff.buffer,
      );
      expect(new TextDecoder().decode(decode(Uint8Array.of(0)))).toBe("AAAAAAAA");
      const cyclic = await huffcdic({ huffcdic: 0, numHuffcdic: 2 }, async (index) =>
        index ? makeDictionary(true).buffer : huff.buffer,
      );
      expect(() => cyclic(Uint8Array.of(0))).toThrow("recursive");
    })();
  },
);

test("KF8 reads any text range from the records that hold it, and from the ends when records are irregular", () =>
  withDom(async () => {
    for (const shortRecord of [undefined, 3]) {
      const { file, raw } = makeKF8Fixture({ recordSize: 16, shortRecord });
      const book = await new MOBI({ unzlib: unzlibSync }).open(file);
      if (!(book instanceof KF8)) throw new Error("Expected KF8 parser");
      try {
        if (shortRecord === undefined) {
          const read: number[] = [];
          const loadText = book.mobi.loadText.bind(book.mobi);
          book.mobi.loadText = (index: number) => {
            read.push(index);
            return loadText(index);
          };
          // Only the records holding the range, plus the last one that proves the records are uniform.
          expect(await book.loadRaw(50, 60)).toEqual(raw.slice(50, 60));
          expect(read.sort((a, b) => a - b)).toEqual([3, Math.ceil(raw.length / 16) - 1]);
          for (const [start, end] of [
            [0, 5],
            [15, 17],
            [40, 90],
            [raw.length - 7, raw.length],
          ] as const)
            expect(await book.loadRaw(start, end)).toEqual(raw.slice(start, end));
          expect(await book.loadRaw(30, 30)).toEqual(new Uint8Array());
        } else {
          // A short record makes offsets unreliable: the book is read sequentially, exactly as stored.
          const stored = joinBytes(
            ...Array.from({ length: Math.ceil(raw.length / 16) }, (_, index) =>
              index === shortRecord ? raw.slice(index * 16, index * 16 + 15) : raw.slice(index * 16, index * 16 + 16),
            ),
          );
          expect(await book.loadRaw(0, 40)).toEqual(stored.slice(0, 40));
        }
      } finally {
        book.destroy();
      }
    }
  }));

test("KF8 without an FDST record reads its single flow and sections", () =>
  withDom(async () => {
    const { file, raw } = makeKF8Fixture({ fdst: false, recordSize: 32 });
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const book = await new MOBI({ unzlib: unzlibSync }).open(file);
      if (!(book instanceof KF8)) throw new Error("Expected KF8 parser");
      try {
        expect(await book.loadFlow(0)).toEqual(raw);
        const doc = await book.sections[0].createDocument!();
        expect(doc.querySelector("#chapter")?.textContent).toBe("Hello KF8 中文");
      } finally {
        book.destroy();
      }
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual([]);
  }));

test("KF8 index strings survive stray bytes after the last CNCX string", () =>
  withDom(async () => {
    const book = await new MOBI({ unzlib: unzlibSync }).open(makeKF8Fixture({ cncxGarbage: true }).file);
    if (!(book instanceof KF8)) throw new Error("Expected KF8 parser");
    try {
      const doc = await book.sections[0].createDocument!();
      expect(doc.querySelector("#chapter")?.textContent).toBe("Hello KF8 中文");
    } finally {
      book.destroy();
    }
  }));
