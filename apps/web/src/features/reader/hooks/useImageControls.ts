import { useLayoutEffect, useRef, useState } from "react";
import { errorCode } from "@read-aware/core";
import { readerImage, type ReaderImageService } from "../../../services/reader-image";
import type { useZoomPan } from "./useZoomPan";
import type { DomainActor } from "../../../platform/domain-actor";
import type { ImageViewLifetime } from "./useImageViewer";

export function useImageControls(zoom: ReturnType<typeof useZoomPan>,
  session: { bookId: string; sessionId: string } | undefined, onClose: (origin?: DomainActor) => void,
  service: ReaderImageService = readerImage, viewerId?: string, lifetime?: ImageViewLifetime) {
  const id = useRef(crypto.randomUUID());
  const owned = useRef<ImageViewLifetime>({ opening: zoom.origin });
  const source = lifetime ?? owned.current;
  const current = useRef({ zoom, onClose });
  current.current = { zoom, onClose };
  const [token, setToken] = useState(0);
  const binding = useRef<ReturnType<ReaderImageService["bind"]> | null>(null);
  useLayoutEffect(() => {
    if (!session) return;
    let bound: ReturnType<ReaderImageService["bind"]>;
    try { bound = service.bind({ ...session, id: viewerId ?? id.current }, {
      close: origin => { source.closedBy ??= origin; current.current.onClose(origin); },
      apply: (request, nextToken, origin) => {
        const view = current.current.zoom;
        if (request.action === "zoom-in") view.zoomIn(origin);
        else if (request.action === "zoom-out") view.zoomOut(origin);
        else if (request.action === "rotate") view.rotateRight(origin);
        else if (request.action === "reset") view.reset(origin);
        else if (request.action === "pan") view.pan(request.dx, request.dy, origin);
        setToken(nextToken);
      },
    }, current.current.zoom.snapshot(), source.opening); }
    catch (error) {
      if (errorCode(error) !== "reader/superseded") throw error;
      current.current.onClose();
      return;
    }
    binding.current = bound;
    const stage = current.current.zoom.stageRef.current;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      bound.publish(current.current.zoom.snapshot(), 0, "system");
    });
    if (stage) resize?.observe(stage);
    return () => { resize?.disconnect(); bound.dispose(source.closedBy ?? source.opening); if (binding.current === bound) binding.current = null; };
  }, [service, session?.bookId, session?.sessionId, viewerId, source]);
  useLayoutEffect(() => { binding.current?.publish(zoom.snapshot(), token, zoom.origin); });
}
