import type { FoliateView } from "./foliate-engine";

/** Virtual locators prove an unchanged section; an old whole-book fraction does not. */
export async function restoreReadingPosition(view: Pick<FoliateView, "goTo" | "goToFraction" | "init">,
  input: { virtual: boolean; reset: boolean; target: string | null; fraction: number }): Promise<void> {
  const target = input.reset && !input.virtual ? null : input.target;
  const fraction = input.reset || input.virtual ? 0 : input.fraction;
  const fallback = async () => {
    // A scrolled fixed-layout renderer already has its first page selected.
    // Relative next() skips that page; init() selects the first linear section.
    if (fraction > 0) await view.goToFraction(fraction).catch(() => view.init());
    else await view.init();
  };
  if (target) await view.goTo(target).then(resolved => resolved ? undefined : fallback(), fallback);
  else await fallback();
}
