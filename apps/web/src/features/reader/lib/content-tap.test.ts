import { describe, expect, test } from "bun:test";
import { resolveDrawnRangeTap } from "./content-tap";

const resting = "epubcfi(/6/18!/4/2,/1:0,/1:20)";

describe("resolveDrawnRangeTap", () => {
  test("a user mark is never treated as the resting unit", () => {
    expect(resolveDrawnRangeTap({ hitValue: "epubcfi(/6/18!/4/4,/1:0,/1:9)", restingCfi: resting, modeActive: true }))
      .toBe("annotation");
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting, modeActive: false })).toBe("annotation");
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: null, modeActive: true })).toBe("annotation");
  });

  test("the resting unit opens its menu on every input surface", () => {
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting, modeActive: true })).toBe("unit-menu");
  });
});
