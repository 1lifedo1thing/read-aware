import { describe, expect, test } from "bun:test";
import { CURATED_FONTS, curatedFacesFor } from "./curated-fonts";
import { buildReaderContentCss, getReaderPreviewStyle, readerFontWeightsNeeded } from "./reader-css";
import {
  DEFAULT_READER_SETTINGS,
  normalizeFontWeight,
  readerFontWeightPresets,
  READER_FONT_WEIGHTS,
  resolveReaderFontWeight,
  type ReaderFontFamily,
  type ReaderFontWeight,
} from "./reader-settings";
import { BUILTIN_READER_PALETTES } from "./reader-theme";

describe("reader font weights", () => {
  test("every built-in option has a real font face and requests it for loading", () => {
    for (const font of CURATED_FONTS) {
      const family: ReaderFontFamily = `curated:${font.id}`;
      const faces = curatedFacesFor(font.id);
      const normalWeights = [...new Set(faces.filter((face) => face.style === "normal").map((face) => face.weight))].sort((a, b) => a - b);
      expect(normalWeights).toEqual([...font.weights]);
      const presets = readerFontWeightPresets(family);
      expect(presets.map<number>((preset) => READER_FONT_WEIGHTS[preset])).toEqual([...font.weights]);
      for (const preset of presets) {
        const requested = readerFontWeightsNeeded(preset, family);
        expect(requested).toContain(READER_FONT_WEIGHTS[preset]);
        expect(requested.every((weight) => normalWeights.includes(weight))).toBe(true);
        // Latin families also supply real italics at every selectable weight.
        if (font.kind !== "cjk") {
          expect(faces.some((face) => face.weight === READER_FONT_WEIGHTS[preset] && face.style === "italic")).toBe(true);
        }
      }
    }
  });

  test("limited families do not offer duplicate-looking weights", () => {
    expect(readerFontWeightPresets("curated:lxgw")).toEqual(["light", "regular", "bold"]);
    expect(readerFontWeightPresets("curated:atkinson")).toEqual(["regular", "bold"]);
    expect(readerFontWeightPresets("curated:lora")).toEqual(["regular", "medium", "semibold", "bold"]);
  });

  test("stored preferences resolve consistently after switching families", () => {
    const cases: [ReaderFontFamily, ReaderFontWeight, ReaderFontWeight][] = [
      ["curated:lxgw", "medium", "regular"],
      ["curated:lxgw", "semibold", "bold"],
      ["curated:atkinson", "light", "regular"],
      ["curated:lora", "black", "bold"],
      ["curated:inter", "black", "black"],
      ["system:Arial", "extra-bold", "extra-bold"],
    ];
    for (const [fontFamily, preferred, actual] of cases) {
      expect(resolveReaderFontWeight(preferred, fontFamily)).toBe(actual);
      const settings = { ...DEFAULT_READER_SETTINGS, fontFamily, fontWeight: preferred };
      const assets = { palette: BUILTIN_READER_PALETTES.warm };
      const weight = READER_FONT_WEIGHTS[actual];
      const bodyRule = buildReaderContentCss(settings, assets).match(/\bbody \{[^}]+\}/)?.[0];
      expect(bodyRule).toContain(`font-weight: ${weight} !important`);
      expect(getReaderPreviewStyle(settings, assets).fontWeight).toBe(weight);
      expect(readerFontWeightsNeeded(preferred, fontFamily)).toContain(weight);
    }
  });

  test("bold uses 700 and new heavy presets survive persistence normalization", () => {
    expect(READER_FONT_WEIGHTS.bold).toBe(700);
    for (const preset of ["semibold", "bold", "extra-bold", "black"] as const) {
      expect(normalizeFontWeight(preset)).toBe(preset);
    }
    for (const invalid of [null, "heavy", "toString", "__proto__", 900]) {
      expect(normalizeFontWeight(invalid)).toBe("regular");
    }
  });
});
