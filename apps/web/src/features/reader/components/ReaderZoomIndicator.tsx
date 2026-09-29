import { useTranslation } from "../../../i18n";
import type { ZoomFeedback } from "../lib/zoom-feedback";
import { useZoomIndicator } from "../hooks/useZoomIndicator";

/**
 * The zoom of a fixed-layout page, shown briefly while it changes — the only
 * place the percentage appears. Same surface as the progress readout; it
 * never takes pointer input, so a pinch or a click passes through to the page.
 */
export function ReaderZoomIndicator({ feedback }: { feedback: ZoomFeedback }) {
  const { t } = useTranslation("reader");
  const indicator = useZoomIndicator(feedback);
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center">
      {indicator?.visible && (
        <span
          // Fades in when it comes up; while it stays up (a live pinch) only
          // the number changes.
          className="ra-motion-fade-in rounded-md bg-[var(--ra-main-surface-color)] px-3 py-1.5 font-sans text-sm tabular-nums text-fg shadow-[0_6px_20px_-6px_rgba(28,25,23,0.35)]"
        >
          <span className="sr-only">{t("pageZoom")} </span>
          {indicator.percent}%
        </span>
      )}
    </div>
  );
}
