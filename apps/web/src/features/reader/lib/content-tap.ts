/** What a tap on a drawn overlay range (a user mark or the navigator's
 *  resting wash) means, given the input surface and the mode's tap policy.
 *
 *  - `annotation`: a user mark; the engine's `show-annotation` flow owns it.
 *  - `unit-menu`: the resting unit's action menu (precise pointers).
 *  - `step`: treat the tap as plain page content. On touch, tap-to-advance
 *    makes the page tap the forward step, and the resting unit covers the
 *    natural tap spot within a step or two, so swallowing that tap to toggle a
 *    menu stalls stepping entirely. Long-press selection still reaches the
 *    same actions, and the compact bar carries the mark actions.
 */
export type DrawnRangeTap = "annotation" | "unit-menu" | "step";

export function resolveDrawnRangeTap(input: {
  hitValue: unknown;
  restingCfi: string | null | undefined;
  modeActive: boolean;
  tapToAdvance: boolean;
  coarsePointer: boolean;
}): DrawnRangeTap {
  const onRestingUnit = input.modeActive && input.restingCfi != null && input.hitValue === input.restingCfi;
  if (!onRestingUnit) return "annotation";
  return input.tapToAdvance && input.coarsePointer ? "step" : "unit-menu";
}
