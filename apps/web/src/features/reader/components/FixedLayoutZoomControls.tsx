import { ChoiceGroup } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { pageFitOptions, resolveFixedLayoutFit } from "../lib/fixed-layout-zoom";
import { useFixedLayoutZoomSetting } from "../hooks/useFixedLayoutZoomSetting";

type Props = {
  bookId: string;
  /** Whether the book reads as a continuous scroll, which decides what the default fit is. */
  scrolled: boolean;
  /** Inline in a list row: the row names it, so the choices carry no legend. */
  inline?: boolean;
  className?: string;
};

/** What 100% fits to — the page's width or the whole page. Choosing one returns the zoom to it. */
export function FixedLayoutFitChoice({ bookId, scrolled, inline = false, className }: Props) {
  const { t } = useTranslation("reader");
  const { zoom, setFit } = useFixedLayoutZoomSetting(bookId);
  return (
    <ChoiceGroup
      label={inline ? undefined : t("pageFit")}
      ariaLabel={inline ? t("pageFit") : undefined}
      value={resolveFixedLayoutFit(zoom.fit, scrolled)}
      options={pageFitOptions(t)}
      onChange={(fit) => setFit(fit)}
      className={className}
    />
  );
}
