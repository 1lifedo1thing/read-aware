import { AppError } from "@read-aware/core";

/** A rejected page does not beat a slower usable page. */
export function firstUsablePage<T>(pages: Promise<T>[]): Promise<T | undefined> {
  return new Promise(resolve => {
    let remaining = pages.length;
    if (!remaining) resolve(undefined);
    for (const page of pages) page.then(resolve, () => { if (!--remaining) resolve(undefined); });
  });
}

/** Optional images have a fixed latency budget. Always settle even if a
 * transport ignores cancellation, and consume losing promises' rejections. */
export async function optionalImages<T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, budgetMs = 5000): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const cancelled = new Promise<undefined>(resolve => {
    stop = () => { controller.abort(); resolve(undefined); };
    timer = setTimeout(stop, budgetMs);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
  try {
    const value = await Promise.race([cancelled, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return read(controller.signal);
    }).catch(() => undefined)]);
    if (signal?.aborted) throw new AppError("search/cancelled", "Web retrieval cancelled");
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    controller.abort();
  }
}
