import { afterAll } from "bun:test";

/**
 * Install browser-like globals (such as `localStorage` or `window`) for the calling test file
 * and restore the previous descriptors once that file finishes.
 *
 * `bun test` runs every file in one process, so a global defined at module scope outlives the
 * file that defined it and silently changes the environment of every later suite. Call this
 * at the top level of a test file: bun registers the `afterAll` hook on that file's scope.
 */
export function installFileGlobals(values: Record<string, unknown>): void {
  const previous = Object.keys(values).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  afterAll(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
}

/** A `Storage`-shaped map for suites that exercise the local KV mirror without a DOM. */
export function memoryStorage(
  entries = new Map<string, string>(),
): Storage & { readonly entries: Map<string, string> } {
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
}
