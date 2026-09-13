import { actorFromEvent, causalActor, type DomainActor } from "../../../platform/domain-actor";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerImageOpen } from "../../../services/reader-image-open";
import type { ActivatedImage } from "../lib/image-activation";
import { AppError } from "@read-aware/core";

export type ImageViewLifetime = { opening: DomainActor; closedBy?: DomainActor };
type ImageView = ActivatedImage & { lifetime: ImageViewLifetime; id: string; session: { bookId: string; sessionId: string } };

/** Native image activation and API opening share one surface and URL lifetime. */
export function useImageViewer(bookId: string | undefined) {
  const [lightboxImage, setValue] = useState<ImageView | null>(null);
  const desired = useRef<ImageView | null>(null);
  const present = useCallback((image: ImageView | null, origin: DomainActor) => {
    if (desired.current) desired.current.lifetime.closedBy ??= origin;
    desired.current = image; setValue(image);
  }, []);
  const interrupt = useRef<(origin?: DomainActor) => void>(() => {});
  const urls = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    for (const [id, url] of urls.current) {
      if (id !== lightboxImage?.id) { URL.revokeObjectURL(url); urls.current.delete(id); }
    }
  }, [lightboxImage]);
  useEffect(() => {
    let unbind: (origin?: DomainActor) => void = () => {}, sessionId: string | null = null;
    let alive = true;
    const stop = readingRuntime.observe(state => {
      const id = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (sessionId === id) return;
      const origin = actorFromEvent(state);
      unbind(origin); interrupt.current = () => {}; sessionId = id; present(null, origin);
      if (id && bookId) {
        const bound = readerImageOpen.bind(id, bookId, {
          present: (viewerId, data, origin) => {
            const src = URL.createObjectURL(data.blob);
            urls.current.set(viewerId, src);
            present({ id: viewerId, src, alt: data.image.alt, session: { bookId, sessionId: id }, lifetime: { opening: origin } }, origin);
          },
          clear: (viewerId, origin) => { if (alive && desired.current?.id === viewerId) present(null, origin); },
        });
        unbind = bound.dispose; interrupt.current = bound.interrupt;
      }
    });
    return () => {
      alive = false; stop(); unbind(); interrupt.current = () => {};
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [bookId, present]);
  const setLightboxImage = useCallback((image: ActivatedImage & { session: ImageView["session"] }, origin: DomainActor = "user") => {
    const state = readingRuntime.snapshot();
    if (state.status !== "ready" || state.bookId !== bookId || image.session.bookId !== bookId || image.session.sessionId !== state.sessionId) {
      throw new AppError("reader/superseded", "Native image activation belongs to a retired reader");
    }
    origin = causalActor(origin); interrupt.current(origin);
    present({ ...image, id: crypto.randomUUID(), lifetime: { opening: origin } }, origin);
  }, [bookId, present]);
  const closeLightbox = useCallback((origin: DomainActor = "user", id?: string) => {
    if (id !== undefined && desired.current?.id !== id) return;
    origin = causalActor(origin); interrupt.current(origin); present(null, origin);
  }, [present]);
  return { lightboxImage, setLightboxImage, closeLightbox };
}
