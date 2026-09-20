import { useEffect, useState } from "react";
import { appHttpFetch } from "../../../platform/http-client";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { loadWebImage } from "../lib/web-image";

const log = createLogger("chat-image");
export function useWebImage(url: string) {
  const [state, setState] = useState<{ source: string; url?: string; failed?: boolean }>({ source: url });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({ source: url });
    void loadWebImage(url, isTauri() ? appHttpFetch : fetch, controller.signal).then(blob => {
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
    failedImage: () => { log.warn("Retrieved image could not be decoded"); setState({ source: url, failed: true }); } };
}
