/** Bounded local response reuse. Each subscriber owns its cancellation; a shared
 * request is cancelled only when every subscriber has left. Failures never stick. */
export function createRequestCache<T>(options: {
  ttlMs: number; maxBytes: number; maxEntries: number; sizeOf: (value: T) => number; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const stored = new Map<string, { value: T; size: number; expires: number }>();
  const pending = new Map<string, { controller: AbortController; promise: Promise<T>; users: number }>();
  let bytes = 0, generation = 0;
  const drop = (key: string) => { const entry = stored.get(key); if (entry) bytes -= entry.size; stored.delete(key); };
  return {
    clear() {
      stored.clear(); bytes = 0; generation++;
    },
    invalidate: drop,
    async get(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      const hit = stored.get(key);
      if (hit && hit.expires > now()) { stored.delete(key); stored.set(key, hit); return hit.value; }
      drop(key);
      let task = pending.get(key);
      if (!task) {
        const controller = new AbortController();
        const startedGeneration = generation;
        const current: { controller: AbortController; users: number; promise: Promise<T> } = { controller, users: 0,
          promise: Promise.resolve().then(() => load(controller.signal)).then(value => {
          if (!controller.signal.aborted && generation === startedGeneration) {
            const size = options.sizeOf(value);
            for (const [key, entry] of stored) if (entry.expires <= now()) drop(key);
            if (size <= options.maxBytes) {
              drop(key); stored.set(key, { value, size, expires: now() + options.ttlMs }); bytes += size;
              while (bytes > options.maxBytes || stored.size > options.maxEntries) drop(stored.keys().next().value!);
            }
          }
          return value;
        }).finally(() => { if (pending.get(key) === current) pending.delete(key); }) };
        task = current;
        pending.set(key, current);
      }
      const current = task; current.users++;
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (action: () => void) => {
          if (settled) return;
          settled = true; signal?.removeEventListener("abort", abort); current.users--;
          if (!current.users && pending.get(key) === current) { pending.delete(key); current.controller.abort(); }
          action();
        };
        const abort = () => finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
        signal?.addEventListener("abort", abort, { once: true });
        current.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      });
    },
  };
}
