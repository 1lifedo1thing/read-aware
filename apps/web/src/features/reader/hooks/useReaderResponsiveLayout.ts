import { useEffect, useState } from "react";
import { PHONE_VIEWPORT_QUERY } from "@read-aware/ui/media";
import { actorFromEvent, causalActor } from "../../../platform/domain-actor";
import { hostWindow } from "../../../services/window";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader-responsive-layout");

/** Publish the responsive choice together with its matching native source.
 * Retire delayed reads on another resize, breakpoint reversal or unmount. */
export function useReaderResponsiveLayout() {
  const [layout, setLayout] = useState(() => ({ exclusive: typeof window !== "undefined" && window.matchMedia(PHONE_VIEWPORT_QUERY).matches,
    origin: causalActor("system") }));
  useEffect(() => {
    const media = window.matchMedia(PHONE_VIEWPORT_QUERY);
    let revision = 0, active = true, published = layout.exclusive;
    let sample = { width: window.innerWidth, height: window.innerHeight, exclusive: published };
    const changed = () => {
      const next = { width: window.innerWidth, height: window.innerHeight, exclusive: media.matches };
      if (next.width === sample.width && next.height === sample.height && next.exclusive === sample.exclusive) return;
      const before = sample;
      sample = next;
      const request = ++revision;
      if (next.exclusive === published) return;
      if (before.width === next.width && before.height === next.height) {
        // A media-query change without a viewport resize (for example a font
        // metric change) must not reuse an older window command's source.
        published = next.exclusive;
        setLayout({ exclusive: published, origin: causalActor("system") });
        return;
      }
      void hostWindow.layout().then(native => {
        if (!active || request !== revision || window.innerWidth !== next.width || window.innerHeight !== next.height || media.matches !== next.exclusive) return;
        const origin = native && native.width === next.width && native.height === next.height ? actorFromEvent(native) : causalActor("system");
        published = next.exclusive;
        setLayout({ exclusive: published, origin });
      }).catch(error => {
        if (!active || request !== revision || window.innerWidth !== next.width || window.innerHeight !== next.height || media.matches !== next.exclusive) return;
        log.warn("Responsive window source unavailable", error);
        // Keep the layout usable when native state cannot be read. Such a
        // failure is not proof of complete native causal attribution.
        published = next.exclusive;
        setLayout({ exclusive: published, origin: causalActor("system") });
      });
    };
    media.addEventListener("change", changed);
    window.addEventListener("resize", changed);
    changed();
    return () => { active = false; revision++; media.removeEventListener("change", changed); window.removeEventListener("resize", changed); };
    // The subscription owns its last published choice across React commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return layout;
}
