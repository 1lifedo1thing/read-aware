import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { detectBookLanguage, inferBookLanguage, normalizeBookLanguage } from "./book-language";
import type { FoliateBook } from "./foliate-engine";

test("language keys group regional editions and reject missing/invalid languages", () => {
  for (const [tag, language] of [["zh-Hans-CN", "zh"], ["zh_TW", "zh"], ["en-GB", "en"], ["fr-CA", "fr"], ["ja", "ja"]]) {
    expect(normalizeBookLanguage(tag)).toBe(language);
  }
  for (const invalid of [null, "", "und", "mul", "zxx", "en<script>"]) expect(normalizeBookLanguage(invalid)).toBeNull();
});

test("metadata decides the book language without reading or following quotations", async () => {
  let reads = 0;
  const book: FoliateBook = { metadata: { language: ["en-US", "zh"] }, sections: [{
    id: "chapter", size: 1, load: () => "", createDocument: () => { reads++; throw Error("must not read"); },
  }] };
  expect(await detectBookLanguage(book)).toBe("en");
  expect(reads).toBe(0);
  expect(await detectBookLanguage({ ...book, metadata: { language: "fr" } })).toBe("fr");
});

test("missing metadata falls back to document language, then bounded script evidence", async () => {
  const html = new JSDOM('<html lang="de-DE"><body>Ein deutsches Buch.</body></html>');
  try {
    const book: FoliateBook = { sections: [{ id: "one", size: 1, load: () => "", createDocument: () => html.window.document }] };
    expect(await detectBookLanguage(book)).toBe("de");
    html.window.document.documentElement.removeAttribute("lang");
    html.window.document.body.textContent = "这是一本中文书，我们在阅读时使用自己喜欢的字体。".repeat(8);
    expect(await detectBookLanguage(book)).toBe("zh");
    html.window.document.body.textContent = "Un livre français sans indication de langue.".repeat(8);
    expect(await detectBookLanguage(book)).toBe("und");
  } finally { html.window.close(); }
  expect(inferBookLanguage("日本語の本を読みます。ひらがなとカタカナがあります。".repeat(5))).toBe("ja");
  expect(inferBookLanguage("이 책은 한국어로 쓰여 있습니다. 편안하게 읽을 수 있습니다.".repeat(5))).toBe("ko");
});
