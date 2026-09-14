import { actorFromEvent, causalActor, type DomainActor } from "../../../platform/domain-actor";
import { hostWindow } from "../../../services/window";
import type { WindowViewport } from "../../../services/window-controller";

export type ResizeSample = {
  width: number; height: number;
  viewport: WindowViewport;
};

export function sampleResize(element: HTMLElement): ResizeSample {
  const window = element.ownerDocument.defaultView;
  return { width: element.clientWidth, height: element.clientHeight,
    viewport: { width: window?.innerWidth ?? 0, height: window?.innerHeight ?? 0 } };
}

export const sameResizeSample = (a: ResizeSample, b: ResizeSample) => a.width === b.width && a.height === b.height
  && a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height;

/** Matching geometry or an unchanged native input generation binds DOM feedback
 * to a dispatched window request. The caller retires the sample if its view changes while
 * this read waits behind the native window operation. Other element changes
 * keep the explicit render source supplied by their owner. */
export async function resizeSource(before: ResizeSample, next: ResizeSample, renderOrigin: DomainActor | undefined,
  readWindow: () => Promise<WindowViewport | null> = () => hostWindow.layout(),
  fallback: () => Promise<DomainActor | undefined> = () => hostWindow.layoutOrigin()): Promise<DomainActor> {
  if (before.viewport.width === next.viewport.width && before.viewport.height === next.viewport.height) return causalActor(renderOrigin ?? "system");
  let native: WindowViewport | null;
  try { native = await readWindow(); }
  catch (error) { const origin = await fallback(); if (origin) return origin; throw error; }
  if (native && native.width === next.viewport.width && native.height === next.viewport.height) return actorFromEvent(native);
  return await fallback() ?? causalActor("system");
}
