import { describe, expect, test } from "bun:test";
import { resolveDrawnRangeTap } from "./content-tap";

const resting = "epubcfi(/6/18!/4/2,/1:0,/1:20)";

describe("resolveDrawnRangeTap", () => {
  test("a user mark is never treated as the resting unit", () => {
    expect(resolveDrawnRangeTap({ hitValue: "epubcfi(/6/18!/4/4,/1:0,/1:9)", restingCfi: resting,
      modeActive: true, tapToAdvance: true, coarsePointer: true })).toBe("annotation");
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting,
      modeActive: false, tapToAdvance: true, coarsePointer: true })).toBe("annotation");
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: null,
      modeActive: true, tapToAdvance: true, coarsePointer: true })).toBe("annotation");
  });

  test("a precise pointer opens the resting unit's menu", () => {
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting,
      modeActive: true, tapToAdvance: true, coarsePointer: false })).toBe("unit-menu");
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting,
      modeActive: true, tapToAdvance: false, coarsePointer: false })).toBe("unit-menu");
  });

  test("touch with tap-to-advance keeps the resting unit tappable as a step", () => {
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting,
      modeActive: true, tapToAdvance: true, coarsePointer: true })).toBe("step");
    // Tap-to-advance disarmed: touch taps toggle the shell, so the wash keeps its menu.
    expect(resolveDrawnRangeTap({ hitValue: resting, restingCfi: resting,
      modeActive: true, tapToAdvance: false, coarsePointer: true })).toBe("unit-menu");
  });
});
