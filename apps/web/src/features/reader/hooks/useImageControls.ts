import { useLayoutEffect, useRef, useState } from "react";
import { errorCode } from "@read-aware/core";
import { readerImage, type ReaderImageService } from "../../../services/reader-image";
import type { useZoomPan } from "./useZoomPan";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";
import type { ImageViewLifetime } from "./useImageViewer";
import { resizeSource, sameResizeSample, sampleResize } from "../lib/resize-source";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader-image-layout");

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
    let sample = stage ? sampleResize(stage) : undefined;
    let generation = 0;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (!stage || !sample || binding.current !== bound) return;
      const next = sampleResize(stage), before = sample;
      if (sameResizeSample(before, next)) return;
      sample = next;
      const request = ++generation, view = current.current.zoom;
      const intent = view.intentRevision.current;
      void resizeSource(before, next, undefined).catch(error => {
        // Geometry remains observable when the OS state query fails. This is
        // an uncorrelated layout change, not a claimed native-command effect.
        log.warn("Image layout source unavailable", error);
        return causalActor("system");
      }).then(origin => {
        if (generation !== request || source.closedBy || view.intentRevision.current !== intent || binding.current !== bound || current.current.zoom.snapshot !== view.snapshot
          || current.current.zoom.origin !== view.origin || !sameResizeSample(next, sampleResize(stage))) return;
        bound.publish(view.snapshot(), 0, origin);
      });
    });
    if (stage) resize?.observe(stage);
    return () => { generation++; resize?.disconnect(); bound.dispose(source.closedBy ?? source.opening); if (binding.current === bound) binding.current = null; };
  }, [service, session?.bookId, session?.sessionId, viewerId, source]);
  // Parent renders do not make a new zoom intent. A geometry-only change is
  // published by its resize sample, not under the previous pan/zoom's source.
  useLayoutEffect(() => { binding.current?.publish(zoom.snapshot(), token, zoom.origin); }, [zoom.snapshot, token, zoom.origin]);
}
