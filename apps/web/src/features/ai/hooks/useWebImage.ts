import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../../../platform/logger";
import { cachedWebImage } from "../lib/web-image-cache";

const log = createLogger("chat-image");
export function useWebImage(url: string) {
  const [state, setState] = useState<{ source: string; url?: string; failed?: boolean }>({ source: url });
  const [openedSource, setOpenedSource] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeViewer = useCallback(() => {
    setOpenedSource(null);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({ source: url });
    void cachedWebImage(url, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ source: url, url: objectUrl });
    }).catch(error => {
      if (controller.signal.aborted) return;
      log.warn("Could not load retrieved image", error);
      setState({ source: url, failed: true });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return { ...(state.source === url ? state : { source: url }),
    triggerRef, openViewer: () => setOpenedSource(url), closeViewer,
    viewerUrl: openedSource === url && state.source === url && !state.failed ? state.url : undefined,
    failedImage: () => { log.warn("Retrieved image could not be decoded"); setState({ source: url, failed: true }); } };
}
