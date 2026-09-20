import { AppError } from "@read-aware/core";
import { publicWebUrl, type AgentFetch } from "@read-aware/agent";

const MAX_BYTES = 4 * 1024 * 1024;

/** Reuse the host HTTP transport, then display a local blob under the existing
 * production img-src policy. No search key, cookies or referrer go to the image. */
export async function loadWebImage(url: string, transport: AgentFetch, signal: AbortSignal): Promise<Blob> {
  const safe = publicWebUrl(url);
  if (!safe.startsWith("https:")) throw new AppError("search/invalid-input", "Image must use HTTPS");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  const timer = setTimeout(() => controller.abort(), 15_000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const combined = controller.signal;
  try {
    combined.throwIfAborted();
    const response = await transport(safe, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: combined });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!response.ok || !type || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type)) {
      await response.body?.cancel();
      throw new AppError("search/fetch-failed", "Image response is not a supported raster image");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError("search/fetch-failed", "Image response is empty");
    let length = 0;
    const parts: Uint8Array<ArrayBuffer>[] = [];
    try {
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new AppError("search/too-large", "Image exceeds 4 MiB");
        parts.push(new Uint8Array(value));
      }
      combined.throwIfAborted();
      if (!length) throw new AppError("search/fetch-failed", "Image response is empty");
      return new Blob(parts, { type });
    } finally {
      await reader.cancel().catch(() => { /* Transfer is already complete or failing. */ });
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
