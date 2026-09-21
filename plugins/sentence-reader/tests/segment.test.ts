import { describe, expect, test } from "bun:test";
import { segmentTextUnits } from "../src/segment";

function pieces(text: string, language = "en") {
  return segmentTextUnits({ text, language, unitId: "sentence" })
    .map(({ start, end }) => text.slice(start, end));
}

describe("Sentence Reader segmentation", () => {
  test("keeps punctuation and trims whitespace around English sentences", () => {
    const text = "  Hello world.  Next sentence!  ";
    expect(pieces(text)).toEqual(["Hello world.", "Next sentence!"]);
  });

  test("does not turn hard source line wraps into sentence boundaries", () => {
    const text = "A hard\nwrapped sentence. Next sentence.";
    expect(pieces(text)).toEqual([
      "A hard\nwrapped sentence.",
      "Next sentence.",
    ]);
  });

  test("uses locale-aware CJK sentence boundaries", () => {
    const text = "你好。世界！再见？";
    expect(pieces(text, "zh-CN")).toEqual(["你好。", "世界！", "再见？"]);
  });

  test("paragraph mode returns one trimmed block span", () => {
    const text = "  First sentence. Second sentence.  ";
    const spans = segmentTextUnits({ text, language: "en", unitId: "paragraph" });
    expect(spans).toEqual([{ start: 2, end: text.length - 2 }]);
  });

  test("falls back to the runtime locale for an invalid language tag", () => {
    expect(() => pieces("One. Two.", "not_a_locale")).not.toThrow();
    expect(pieces("One. Two.", "not_a_locale")).toEqual(["One.", "Two."]);
  });

  test("rejects unit ids the plugin did not declare", () => {
    expect(segmentTextUnits({ text: "Hello.", language: "en", unitId: "page" })).toEqual([]);
  });
});

describe("Sentence Reader dialogue quotes", () => {
  test("an opening quote after a terminator starts the next sentence", () => {
    const text = "“你好。”他说。“再见！”她答道。";
    expect(pieces(text, "zh-CN")).toEqual(["“你好。”", "他说。", "“再见！”", "她答道。"]);
  });

  test("opening brackets and spaces before them move with the next sentence", () => {
    const text = "He paused. “Well,” she said. （注）下一句。";
    const parts = pieces(text, "en");
    expect(parts[0]).toBe("He paused.");
    expect(parts[1]!.startsWith("“Well,”")).toBe(true);
    expect(parts[parts.length - 1]!.startsWith("（注）")).toBe(true);
    expect(parts.some(part => /[“（]$/.test(part))).toBe(false);
  });

  test("a segment that is only an opening mark is left alone", () => {
    const text = "“";
    expect(pieces(text, "zh-CN")).toEqual(["“"]);
  });
});

describe("Sentence Reader abbreviations", () => {
  test("honorifics, Latin shorthands and initials do not end a sentence", () => {
    const text = "Mr. Smith met Dr. Jones at 3 p.m. today, e.g. for tea. J. K. Rowling wrote it. Fine.";
    expect(pieces(text)).toEqual([
      "Mr. Smith met Dr. Jones at 3 p.m. today, e.g. for tea.",
      "J. K. Rowling wrote it.",
      "Fine.",
    ]);
  });

  test("ordinary words and dotted acronyms keep their sentence end", () => {
    expect(pieces("I said no. Then I left.")).toEqual(["I said no.", "Then I left."]);
    expect(pieces("We moved to the U.S. Then we left.")).toEqual(["We moved to the U.S.", "Then we left."]);
    expect(pieces("Bring apples, pears, etc. Then go.")).toEqual(["Bring apples, pears, etc.", "Then go."]);
  });
});
