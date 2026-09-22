/** What a tap on a drawn overlay range (a user mark or the navigator's
 *  resting wash) means.
 *
 *  - `annotation`: a user mark; the engine's `show-annotation` flow owns it.
 *  - `unit-menu`: the resting unit's action menu, on every input surface. On
 *    touch with tap-to-advance the resting sentence can walk under the finger
 *    within a step or two, so a tap there interrupts stepping with the menu;
 *    that is the reader's decision (the menu is the sentence's action surface,
 *    and the next tap outside it steps on).
 */
export type DrawnRangeTap = "annotation" | "unit-menu";

export function resolveDrawnRangeTap(input: {
  hitValue: unknown;
  restingCfi: string | null | undefined;
  modeActive: boolean;
}): DrawnRangeTap {
  const onRestingUnit = input.modeActive && input.restingCfi != null && input.hitValue === input.restingCfi;
  return onRestingUnit ? "unit-menu" : "annotation";
}
